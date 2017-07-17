import type {
  AuthConfig,
  Issue,
  IssueComment,
  Entity,
  EntityService,
  EntityMapping,
  DoSingleEntityAction,
} from './types'

import "colors"
import normalizeNewline from 'normalize-newline'

import integrationRest from "./integrationRest"
import helpers from "./helpers"

// import auth from "../config/auth.config"
const auth: AuthConfig = require ("../config/auth.config").default
import {
  services,
  forceMirroringTag,
  mirrorMetaVarName,
  closedStateField,
} from '../config/const.config'

import settings from "../config/settings.config"

import Store from './Store'
const store = new Store ()

import UsernameMapping, {UsernameInfo, KnownUsernameInfo} from './UsernameMapping'
const usernameInfos: Array<UsernameInfo> = require('../config/usernames.config').default
const usernameMapping = new UsernameMapping (usernameInfos)

let redoMirroring: boolean = false
let redoWasChanged: boolean = false
let mirroringInProgress: boolean = false
let testTimestamp: number | void = undefined

let isIssuesQueueLocked: boolean = false
let issuesQueue: Array<EntityService> = []

const recentlyCreatedIdsObj: Object = {}

let startTime
let keepTiming

const log = (...args) => {
  // skip lines containing with
  if (true // eslint-disable-line no-constant-condition
    // && args[0].indexOf ("Skip") === -1
    // && args[0].indexOf ("Initial") === -1
    // args[0].indexOf ("Processing") === -1
  )
    console.log(...args) // eslint-disable-line no-console
}

export const webhookHandler = {
  handleRequest: async (service, req, res) => {
    if (service === "youtrack") {
      // respond so that youtrack doesn't hang... (opened an issue about it)
      res.send ()
      // give youtrack time to receive res.send()...
      await helpers.asyncTimeout (1000)
    }

    const rb = req.body

    helpers.throwIfValueNotAllowed (service, services)
    log ("Webhook from".yellow, service, "action:".yellow, (rb.action || "").blue)

    if (["labeled", "unlabeled", "deleted", "created", "opened", "reopened", "closed", "edited", "comments_changed"].indexOf (rb.action) !== -1) {
      const issueId: string | void = webhookHandler.getIssueIdFromRequestBody(service, rb)

      if (!issueId)
        return

      log ("Changed issue:".yellow, service, issueId)
      await webhookHandler.initDoMirroring ({service, issueId})
    }
  },

  operationOnQueue: async (callback: Function) => {
    // eslint-disable-next-line no-unmodified-loop-condition
    while (isIssuesQueueLocked)
      await helpers.asyncTimeout (10)
    isIssuesQueueLocked = true
    await callback ()
    isIssuesQueueLocked = false
  },

  addIssueToQueue: async (issue: EntityService) => {
    const addIssue_cb = () => {
      // add to start
      issuesQueue.unshift (issue)
    }
    await webhookHandler.removeIssueFromQueue (issue)
    await webhookHandler.operationOnQueue (addIssue_cb)
  },

  removeIssueFromQueue: async (issue: EntityService) => {
    const removeIssue_cb = () => {
      issuesQueue = issuesQueue.filter ((queuedIssue) => (
        webhookHandler.getUniqueEntityServiceId (queuedIssue) !==
        webhookHandler.getUniqueEntityServiceId (issue)
      ))
    }
    await webhookHandler.operationOnQueue (removeIssue_cb)
  },

  getIssuesQueue: () => [...issuesQueue],
  getIsIssuesQueueLocked: () => isIssuesQueueLocked,

  initDoMirroring: async (opts: Object = {}) => {
    if (opts.testTimestamp !== undefined)
      testTimestamp = opts.testTimestamp

    if (opts.issueId) {
      const issueService: EntityService = {
        id: opts.issueId,
        service: opts.service,
      }
      await webhookHandler.addIssueToQueue (issueService)
    }

    startTime = startTime || new Date ().getTime ()
    keepTiming = false
    await webhookHandler.doMirroring ()
  },

  // fetch all issues and comments,
  // sort originals first then mirrors,
  // map IDs in that order,
  // call doSingleEntity for each issue,
  // for each issue, call doSingleEntity for all comments.
  doMirroring: async () => {
    if (mirroringInProgress) {
      redoMirroring = true
      redoWasChanged = true
      return
    }
    redoMirroring = false
    mirroringInProgress = true

    // wait to reduce frequency of requests.. github will return Forbidden
    await helpers.asyncTimeout (1000)

    let issues: Array<Issue> = []
    let counterparts: Array<Issue> = []
    const allIssues = await webhookHandler.getAllIssues ()

    if (webhookHandler.getIssuesQueue ().length !== 0) {
      issues = webhookHandler.getQueuedIssues (allIssues)
      counterparts = webhookHandler.getCounterparts (allIssues)

      // remove mappings to refetch them
      issues.concat (counterparts).forEach ((issue) => {
        webhookHandler.removeMappingContaining ({issueId: issue.id})
      })
    }
    else issues = allIssues

    // sort issue origs first, do ids mapping
    await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (issues).map (async (issue) => {
      log ("Mapping".grey, webhookHandler.entityLog (issue))

      const isMirror = !webhookHandler.getIsOriginal (issue)

      const toApply = {}

      // if we are using queue, reset lastAction
      if (webhookHandler.getIssuesQueue ().length !== 0)
        toApply.lastAction = undefined

      // setting false to indicate that the mirror has been delivered
      if (isMirror)
        toApply.waitingForMirror = false

      webhookHandler.addToMapping (issue, toApply)
    }))

    const issuesWaitingForMirrors: Array<EntityService> = webhookHandler.getOriginalsWaitingForMirrors ()


    // check if there are originals waiting for mirrors
    if (issuesWaitingForMirrors.length > 0) {
      log ("Waiting webhook from mirrors of".blue, issuesWaitingForMirrors.map (
        (entityService) => webhookHandler.entityLog (entityService)).join (", "))
      keepTiming = true
    }

    let newIssuesCreated = false

    // call doSingleEntity one by one issue
    for (let i = 0; i < issues.length; ++i) {
      const issue = issues[i]

      const issueMapping = webhookHandler.getEntityServiceMapping (issue)
      const lastAction = issueMapping && issueMapping.lastAction

      if (["updated", "skipped_equal"].indexOf (lastAction) !== -1) {
        log ("Skip already addressed issue".grey, webhookHandler.entityLog (issue), lastAction.grey)
        continue
      }

      log ("Processing issue".grey, webhookHandler.entityLog (issue))

      const otherEntity = webhookHandler.getOtherEntity (issue)
      const actionTaken: DoSingleEntityAction = await webhookHandler.doSingleEntity (issue, otherEntity)

      if (actionTaken === "deleted") {
        webhookHandler.removeMappingContaining (issue)
        webhookHandler.removeIssueFromQueue (issue)
      }

      // todo, refactor lastAction
      if (["created", "updated", "skipped_equal"].indexOf (actionTaken) !== -1)
        webhookHandler.addToMapping (issue, {lastAction: actionTaken})

      if (actionTaken === "created") {
        // setting true to indicate that the mirror has been requested
        webhookHandler.addToMapping (issue, {waitingForMirror: true})
        newIssuesCreated = true
      }
    }

    if (issues.length === 0) {
      log ("No issues to mirror")
      mirroringInProgress = false
    }

    if (newIssuesCreated) {
      log ("Created issues during last run".grey, "waiting".cyan)
      // todo keepTiming
    }
    else {
      const allComments: Array<IssueComment> = []
      // get all comments
      issues = issues.concat (counterparts)
      await Promise.all (issues.map (async (issue) => {
        // fetching issue comments
  /*
        //bug: youtrack not including recently created comment
        let issueComments
        if (issue.service === "youtrack")
          issueComments = issue.rawComments.map ((rawComment) => webhookHandler.getFormatedComment (issue.service, rawComment, issue.id))
        else
  */
        const issueComments = await webhookHandler.getComments (issue.service, issue.id)
        allComments.push (...issueComments)

        // adding as property to call doSingleEntity for comments at once on all issues
        issue.comments = issueComments
      }))

      // sort comment origs first, do ids mapping
      await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (allComments).map (async (comment) => {
        // mapping sorted comments origs first
        webhookHandler.addToMapping (comment)
      }))

      // await Promise.all (issues.map (async (issue) => {

      // call doSingleEntity for comments of every issue
      for (let j = 0; j < issues.length; ++j) {
        const issue = issues[j]

        for (let i = 0; i < issue.comments.length; ++i) {
          const comment: IssueComment = issue.comments[i]

          const commentMapping = webhookHandler.getEntityServiceMapping (comment)
          const lastAction = commentMapping && commentMapping.lastAction

          if (["created", "updated", "skipped_equal"].indexOf (lastAction) !== -1) {
            log ("Skip already addressed comment".grey, webhookHandler.entityLog (comment), lastAction.grey)
            continue
          }

          const otherEntity = webhookHandler.getOtherEntity (comment)
          const actionTaken: DoSingleEntityAction = await webhookHandler.doSingleEntity (comment, otherEntity)

          if (actionTaken === "deleted") {
            webhookHandler.removeMappingContaining (comment)
          }
          else if (["created", "updated", "skipped_equal"].indexOf (actionTaken) !== -1)
            webhookHandler.addToMapping (comment, {lastAction: actionTaken})

          /*
          if (["created", "deleted"].indexOf (actionTaken) !== -1) {
            // move log to after promise.all
            // log ("Comment action made".blue, webhookHandler.entityLog (comment).yellow, actionTaken.grey, "waiting".cyan)

            keepTiming = true
            // break for the order of comments, check that the comment is there
            break
          }
          */
        }
        webhookHandler.removeIssueFromQueue (issue)
      }
    }

    mirroringInProgress = false
    if (redoMirroring) {
      // keepTiming = true //todo
      log ("Received webhook during last run".grey, "restarting".cyan)
      redoWasChanged = false

      return await webhookHandler.initDoMirroring ()
    }
    else if (!keepTiming) {
      // if no webhook triggered in the meantime
      if (redoWasChanged) {
        // keepTiming = true //todo
        log ("Possible changes due webhooks", "restarting".cyan)
        redoWasChanged = false
        return await webhookHandler.initDoMirroring ()
      }

      log ("Done", webhookHandler.getFormatedTimeFromStart ().yellow)
      startTime = undefined

      log ("Continue listening for changes".cyan)
    }
    else {
      // timeout?
    }
  },

  getAllIssues: async () => {
    const allIssues: Array<Issue> = []
    await Promise.all (services.map (async (service) => {
      const projectIssues: Array<Issue> = await webhookHandler.getProjectIssues (service, testTimestamp)

      log ("Issues count", service, projectIssues.length)

      let filteredIssues

      switch (service) {
        case "youtrack": {
          filteredIssues = projectIssues.reverse ().filter ((issue) => {
            const isOriginal = webhookHandler.getIsOriginal (issue)
            if (isOriginal === false)
              return true

            const hasForceMirroringTag = issue.tags && issue.tags.indexOf (forceMirroringTag) !== -1
            if (hasForceMirroringTag)
              return true

            const isYoutrackBlacklisted = webhookHandler.getIsIssueBlacklistedByTags (issue)
            if (isYoutrackBlacklisted)
              return false

            const isSensitive = webhookHandler.getEntityContainsSensitiveInfo (issue)
            if (isSensitive)
              return false

            return true
          })
          break
        }
        case "github": {
          filteredIssues = projectIssues.filter ((issue) => {
            if (webhookHandler.getIsOriginal (issue))
              return true

            const meta = webhookHandler.getMeta (issue)
            return !meta.deleted
          })
        }
          break
      }

      log ("Filtered issues count", service, filteredIssues.length)

      allIssues.push (...filteredIssues)
    }))
    return allIssues
  },

  // call doSingleEntity from doMirroring only
  // returns a string of action taken
  doSingleEntity: async (entity: Entity, otherEntity: Entity | void): DoSingleEntityAction  => {
    // todo use await Promise.all (services.map (async (targetService) => { doSingleEntity (targetService)
    // instead getOtherEntity from inside

    // if original
    if (webhookHandler.getIsOriginal (entity)) {
      // if has mirror
      if (otherEntity) {
        // skip if equal
        if (webhookHandler.getIsOriginalEqualToMirror (entity, otherEntity)) {
          log ("Skip updating equal mirror of".grey, webhookHandler.entityLog (entity))
          return "skipped_equal"
        }

        // update if not equal
        log ("Update mirror ".green + webhookHandler.entityLog (otherEntity),
          "of".green, webhookHandler.entityLog (entity))

        await webhookHandler.updateMirror (entity)
        return "updated"
      }
      else {
        log ("Create mirror of".magenta, webhookHandler.entityLog (entity))
        await webhookHandler.createMirror (entity)
        return "created"
      }
    }
    // else is mirror

    // if has original
    if (otherEntity) {
      const preparedMirror: Entity = webhookHandler.getPreparedMirrorEntityForUpdate (entity, otherEntity.service)

      if (!webhookHandler.areLabelsEqual (preparedMirror.labels, otherEntity.labels) ||
        preparedMirror.state !== otherEntity.state) {
        await webhookHandler.updateMirror (entity, {skipTitle: true, skipBody: true})
        return "updated"
      }

      // nothing, original will be called from doMirroring
      log ("Skip mirror".grey, webhookHandler.entityLog (entity),
        "of".grey, webhookHandler.entityLog (otherEntity))
      return "skipped_mirror"
    }

        // delete
    log ("Deleting mirror".red, webhookHandler.entityLog (entity))
    await webhookHandler.deleteEntity (entity)
        // return to indicate a change that will redo doMapping
    return "deleted"
  },

  getCounterparts: (issues: Array<Issue>): Array<Issue> => {
    const uniqueIds: Array<string> = []
    issues.forEach (issue => {
      const localCounterpart = webhookHandler.getOtherEntity (issue)
      if (localCounterpart)
        uniqueIds.push (webhookHandler.getUniqueEntityServiceId (localCounterpart))
    })
    return issues.filter ((issue) => {
      const uniqueId = webhookHandler.getUniqueEntityServiceId (issue)
      return uniqueIds.indexOf (uniqueId) !== -1
    })
  },

  getQueuedIssues: (issues: Array<Issue>): Array<Issue> => {
    const uniqueIds: Array<string> = webhookHandler.getIssuesQueue ().map ((issue) =>
      webhookHandler.getUniqueEntityServiceId (issue))

    return issues.filter ((issue) => {
      const uniqueId = webhookHandler.getUniqueEntityServiceId (issue)
      return uniqueIds.indexOf (uniqueId) !== -1
    })
  },

  getEntitiesWithOriginalsFirst: (sourceList: Array<Entity>): Array<Entity> => {
    const originals = []
    const mirrors = []

    sourceList.forEach ((entity) => {
      if (webhookHandler.getIsOriginal (entity))
        originals.push (entity)
      else mirrors.push (entity)
    })
    return originals.concat (mirrors)
  },

  removeMappingContaining: (containsObj: Object) => {
    if (containsObj.issueId !== undefined)
      store.commentMappings.removeMappingContaining (containsObj)
    else store.issueMappings.removeMappingContaining (containsObj)
  },

  getOriginalsWaitingForMirrors: (areComments: boolean = false): Array<EntityService> => {
    const storeMappings = areComments ? store.commentMappings : store.issueMappings
    return storeMappings.mappings
    .filter ((f) => f.waitingForMirror)
    .map ((m) => m.services.filter ((f) => f.service === m.originalService)[0])
  },

  getEntityServiceMapping: (entityService: EntityService) => {
    const storeMappings = webhookHandler.getIsComment (entityService) ? store.
      commentMappings : store.issueMappings
    return storeMappings.mappings.filter ((m) =>
      m.services.filter ((s) => s.service === entityService.service && s.id === entityService.id)[0])[0]
  },

  getProjectIssues: async (sourceService: string, sinceTimestamp: number | void) => {
    const query = {}

    switch (sourceService) {
      case "youtrack": {
        query.max = 100000

        if (sinceTimestamp !== undefined)
          query.updatedAfter = sinceTimestamp

        return await webhookHandler.getProjectIssuesRaw (sourceService, query)
      }
      case "github": {
        // NOTE here is specified which issues should be mirrored to Youtrack
        // temporary: this is single direction mirroring, yt -> gh, allowing only changes of mirrors
        /*
        const openQuery = {state: "open", labels: "Mirroring"}
        const closedQuery = {state: "closed", labels: "Mirroring"}

        const openIssues = await webhookHandler.getProjectIssuesRaw (sourceService, openQuery)
        const closedIssues = await webhookHandler.getProjectIssuesRaw (sourceService, closedQuery)
        return openIssues.concat (closedIssues)
        */
        query.state = "all"
        query.per_page = 100

        if (sinceTimestamp !== undefined)
          query.since = new Date(sinceTimestamp).toISOString()

        return await webhookHandler.getProjectIssuesRaw (sourceService, query)
      }
    }
  },

  //composeYoutrackId: (id: string): string => `${auth.youtrack.project}-${id}`,
  //extractYoutrackId: (fullId: string): string => fullId.split("-")[1],

  getProjectIssuesRaw: async (sourceService: string, query: Object | void) => {
    const restParams = {
      service: sourceService,
      method: "get",
      query,
    }

    switch (sourceService) {
      case "youtrack":
        restParams.url = `issue/byproject/${auth.youtrack.project}`
        break
      case "github":
        // restParams.sort = "created" // have to do it manually anyway (async per page)
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues`
        break
    }

    let linksObj
    let rawIssues = await integrationRest (restParams)
    .then ((response) => {linksObj = response.links; return response.body})
    .catch ((err) => {throw err})

    // embrace forced pagination...
    if (sourceService === "github" && linksObj && linksObj.last) {
      const lastUrl = linksObj.last
      const urls = []
      const afterUrlIndex = helpers.getIndexAfterLast (`${auth.github.url}/`, lastUrl)
      const afterPageEqIndex = helpers.getIndexAfterLast ("page=", lastUrl)
      const pagesCount/*: number */= Number.parseInt (lastUrl.substring (afterPageEqIndex))

      // starting from 2, already have page1 issues,
      // including pagesCount as page1 is first not page0,
      // +1 to get extra page just to be sure (new issue pushes another to last+1 page)
      for (let i = 2; i <= pagesCount + 1; ++i) {
        const url = lastUrl.substring (afterUrlIndex, afterPageEqIndex) + i
        urls.push (url)
      }
      const linksParams = {
        service: "github",
        method: "get",
      }
      await Promise.all (urls.map (async (url) => {
        const perPageIssues = await integrationRest ({...linksParams, url})
        .then ((response) => response.body)
        .catch ((err) => {throw err})

        rawIssues.push (...perPageIssues)
      }))
    }

    if (sourceService === "github")
      rawIssues = rawIssues.filter ((ri) => !ri.pull_request)

    const issues = []

    for (let i = 0; i < rawIssues.length; ++i) {
      const rawIssue = rawIssues[i]
      issues.push (webhookHandler.getFormatedIssue (sourceService, rawIssue))
    }

    return issues
  },

  doStuff: async (req, res) => {
    res.send (`<div>Elapsed: ${webhookHandler.getFormatedTimeFromStart ()}</div><pre>${JSON.stringify(store, null, "    ")}</pre>`)
  },

  getIssueIdFromRequestBody: (sourceService: string, reqBody: Object): string | void => {
    if (sourceService === "youtrack") return reqBody.issueId.toString ()
    if (sourceService === "github") return reqBody.issue && reqBody.issue.number.toString ()
  },

  getIdFromRawIssue: (sourceService: string, rawIssues: Object): string => {
    if (sourceService === "youtrack") return rawIssues.id.toString ()
    if (sourceService === "github") return rawIssues.number.toString ()
  },

  getEntityService: (knownEntityService: EntityService, targetService: string): EntityService | void => {
    const mappings = webhookHandler.getIsComment (knownEntityService) ?
      store.commentMappings : store.issueMappings
    return mappings.getEntityService (knownEntityService, targetService)
  },

  getTargetEntity: (knownEntityService: EntityService, targetService: string): Entity | void => {
    const targetEntityService: EntityService | void =
      webhookHandler.getEntityService (knownEntityService, targetService)

    if (!targetEntityService)
      return

    try {
      const targetEntity: Entity = targetEntityService
      return targetEntity
    }
    // eslint-disable-next-line no-empty
    catch (e) {}
  },

  fetchTargetEntity: async (targetEntityService: EntityService): Entity | void => {
    if (targetEntityService.issueId)
      return await webhookHandler.getComment (targetEntityService)

    return await webhookHandler.getIssue (targetEntityService.service, targetEntityService.id)
  },

  getIsOriginal: (issueOrComment: Issue | IssueComment): boolean => {
    const meta = webhookHandler.getMeta (issueOrComment)
    return meta === undefined
  },

  addToMapping: (entity: Entity, assign: Object = {}) => {
    const mappings = webhookHandler.getIsComment (entity) ?
      store.commentMappings : store.issueMappings

    if (webhookHandler.getIsOriginal (entity)) {
      mappings.add (entity, undefined, {
        originalService: entity.service,
        ...assign,
      })
    }
    else {
      const meta = webhookHandler.getMeta (entity)

      if (!meta.service || !meta.id) {
        console.log ("no meta found", entity)
        return
      }

      const knownEntityService: EntityService = {
        service: meta.service,
        id: meta.id,
        issueId: meta.issueId,
      }
      // create mapping to original
      mappings.add (entity, knownEntityService, {
        originalService: meta.service,
        ...assign,
      })
    }
  },

  getEntityFromEntityOrId: async (targetService: string, entityOrId: Entity | string) => {
    if (typeof entityOrId === "string" || !webhookHandler.getIsComment (entityOrId)) {
      return await webhookHandler.getIssue (targetService, entityOrId.id || entityOrId)
    }
    const knownEntityService: EntityService = {
      service: entityOrId.service,
      id: entityOrId.id,
      issueId: entityOrId.issueId,
    }
    return await webhookHandler.getComment (knownEntityService)
  },

  getFormatedTimeFromStart: (): string => {
    const dt = (new Date().getTime () - startTime) / 1000
    return helpers.formatTimestampAsDuration (dt)
  },

  getEntityContainsSensitiveInfo: (entity: Entity): boolean => {
    for (let i = 0; i < settings.sensitiveStrings.length; ++i) {
      const str = settings.sensitiveStrings[i]
      if (entity.body.toLowerCase ().indexOf (str.toLowerCase ()) !== -1) {
        log ("Issue contains sensitive info, omitting".red, str, webhookHandler.entityLog (entity))
        return true
      }
    }
  },

  getIsIssueBlacklistedByTags: (issue: Issue): boolean => {
    // if issue not from youtrack
    if (!issue.tags)
      return false

      // if tags contain force mirroring tag
    if (issue.tags.indexOf (forceMirroringTag) !== -1)
      return false

      // if intersection
    for (let i = 0; i < issue.tags.length; ++i) {
      const tag: string = issue.tags[i]

      if (settings.mirroringBlacklistTags.indexOf (tag) !== -1) {
        log ("Issue is blacklisted for mirroring".grey, webhookHandler.entityLog (issue))
        return true
      }
    }
    // no intersection
    return false
  },

  getOtherEntity: (sourceEntityService: EntityService): Entity | void => {
    let targetService

    switch (sourceEntityService.service) {
      case "github": targetService = "youtrack"; break
      case "youtrack": targetService = "github"; break
    }
    return webhookHandler.getTargetEntity (sourceEntityService, targetService)
  },

  getGithubCounterparts: (issueIds: Array<string>): Array<string> =>
    issueIds.map ((issueId) => {
      const knownEntityService = {service: "youtrack", id: issueId}
      const counterpart = webhookHandler.getEntityService (knownEntityService, "github")
      return counterpart && counterpart.id
    }).filter (Boolean),

  getHierarchyStringBlock: (issue: Issue): string => {
    let s = ""
    if (issue.parentFor || issue.subtaskOf) {
      const parentForGithubIssues = webhookHandler.getGithubCounterparts (issue.parentFor || [])
      const subtaskOfGithubIssues = webhookHandler.getGithubCounterparts (issue.subtaskOf || [])

      if (parentForGithubIssues.length !== 0 || subtaskOfGithubIssues.length !== 0) {
        s += "\n\n#\n" // make slim horizontal line
        if (parentForGithubIssues.length !== 0)
          s += `<code>Parent for:</code> ${parentForGithubIssues.map ((c) => `#${c}`).join (", ")}\n`
        if (subtaskOfGithubIssues.length !== 0)
          s += `<code>Subtask of:</code> ${subtaskOfGithubIssues.map ((c) => `#${c}`).join (", ")}\n`
      }
    }
    return s
  },

  getNameQuote: (entity: Entity, targetService: string): string =>
    `>@${entity.author} commented:\n\n`,

  getPreparedMirrorCommentForUpdate: (comment: IssueComment, targetService: string): Entity => {
    const nameQuote = webhookHandler.getNameQuote (comment, targetService)
    const signature: string = webhookHandler.getMirrorSignature (comment.service, targetService, comment)

    const convertedBody =
      webhookHandler.convertMentions (nameQuote + comment.body, comment.service, targetService)

    return {
      ...comment,
      body: convertedBody + signature,
    }
  },

  getTitlePrefix: (issue: Issue, targetService): string => {
    switch (targetService) {
      case "github": return `[${issue.id}] `
      case "youtrack": return `(#${issue.id}) `
    }
  },

  removeNonLettersFromEnd: (str: string): string => {
    while (str !== "" && str[str.length - 1].match(/[a-z0-9]/i) === null)
      str = str.substring (0, str.length - 1)
    return str || ""
  },

  convertMentions: (body, sourceService, targetService): string =>
    webhookHandler.convertMentionsRaw (body, sourceService, targetService, usernameMapping),

  convertMentionsRaw: (body: string, sourceService: string, targetService: string,
    _usernameMapping: UsernameMapping): string => {
    const replacedBody = body.replace (/\B@[a-z0-9.]+/ig, ((m) => {
      // remove @ symbol
      m = m.substring (1)

      const username = m && webhookHandler.removeNonLettersFromEnd (m)

      if (username) {
        const knownUsernameInfo: KnownUsernameInfo = {
          username,
          service: sourceService,
        }
        const counterpartUsername = _usernameMapping.getUsername (knownUsernameInfo, targetService)

        if (counterpartUsername)
          return `@${counterpartUsername}`
      }

      // else break mention
      return `@'${m}`
    }))

    return replacedBody
  },

  getPreparedMirrorEntityForUpdate: (entity: Entity, targetService: string): Entity => {
    if (webhookHandler.getIsComment (entity))
      return webhookHandler.getPreparedMirrorCommentForUpdate (entity, targetService)
    return webhookHandler.getPreparedMirrorIssueForUpdate (entity, targetService)
  },

  getPreparedMirrorIssueForUpdate: (issue: Issue, targetService: string): Entity => {
    // todo, switch (issue.service) instead
    let labels = issue.fields || issue.tags ? ["Mirroring"] : undefined
    if (issue.fields)
      labels = labels.concat (webhookHandler.getLabelsFromFields (issue.fields))
    if (issue.tags)
      labels = labels.concat (webhookHandler.getLabelsFromTags (issue.tags))

    const hierarchy = webhookHandler.getHierarchyStringBlock (issue)
    const signature = webhookHandler.getMirrorSignature (issue.service, targetService, issue)

    const nameQuote = webhookHandler.getNameQuote (issue, targetService)
    const titlePrefix = webhookHandler.getTitlePrefix (issue, targetService)

    const convertedBody = webhookHandler.convertMentions (nameQuote + issue.body, issue.service, targetService)

    return {
      ...issue,
      title: titlePrefix + issue.title,
      body: convertedBody + hierarchy + signature,
      labels,
    }
  },

  doListsContainSameElements: (listA: Array, listB: Array): boolean =>

    // function name not consistent if duplicate items
    // if (listA.length !== listB.length) return false

     (
      listA.filter ((a) => listB.indexOf (a) === -1).length === 0 &&
      listB.filter ((b) => listA.indexOf (b) === -1).length === 0
    ),

  areLabelsEqual: (l1: Array = [], l2: Array = []): boolean =>
    webhookHandler.doListsContainSameElements (l1, l2),

  getIsOriginalEqualToMirror: (originalEntity: Entity, mirrorEntity: Entity): boolean => {
    const preparedOriginal: Entity = webhookHandler.getPreparedMirrorEntityForUpdate (originalEntity, mirrorEntity.service)

    // comment
    if (webhookHandler.getIsComment (originalEntity))
      return preparedOriginal.body === mirrorEntity.body

    // issue
    const areLabelsEqual = webhookHandler.areLabelsEqual (preparedOriginal.labels, mirrorEntity.labels)

    const areEqual = (
      preparedOriginal.title === mirrorEntity.title &&
      preparedOriginal.body === mirrorEntity.body &&
      preparedOriginal.state === mirrorEntity.state &&
      areLabelsEqual)

    // if (!areEqual) log ({preparedOriginal, mirrorEntity, areLabelsEqual})

    return areEqual
  },

  entityLog: (entityService: EntityService): string => {
    const parts = []
    parts.push (entityService.service.yellow)
    parts.push (entityService.id.yellow)
    if (webhookHandler.getIsComment (entityService))
      parts.push ("(comment)".grey)
    if (!webhookHandler.getIsOriginal (entityService))
      parts.push ("(mirror)".grey)
    return parts.join (" ")
  },

  getIsComment: (entityService: EntityService): boolean => entityService.issueId !== undefined,
    //try {const comment: IssueComment = entity}
    //catch (err) {return false}
    //return true

  deleteEntity: async (entity: Entity) => {
    if (webhookHandler.getIsComment (entity))
      await webhookHandler.deleteCommentInstance (entity)
    else await webhookHandler.deleteIssueInstance (entity)
  },

  deleteIssueInstance: async (issue: Issue) => {
    switch (issue.service) {
      case "github": {
        // delete all comments
        const comments: Array<IssueComment> = await webhookHandler.getComments (issue.service, issue.id)
        await Promise.all (comments.map (
          async (comment) => await webhookHandler.deleteCommentInstance (comment)))

        const signature: string = webhookHandler.getMetaAsIssueCommentHtmlComment ("github", {deleted: true})
        const data = {
          ...issue,
          title: '(Issue removed)',
          body: signature,
          labels: ["IssueRemoved"],
          state: "closed",
        }

        const restParams = {}
        restParams.service = "github"
        restParams.method = "patch"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${issue.id}`
        restParams.data = data

        return await integrationRest(restParams)
        .then ((response) => response.body)
        .catch ((err) => {throw err})
      }
      case "youtrack": {
        // Github issues cannot be deleted, so noop
        // todo: handle case when label "Mirroring" is removed from github original
      }
    }
  },

  deleteCommentInstance: async (comment: IssueComment) => {
    const restParams = {
      service: comment.service,
      method: "delete",
    }
    switch (comment.service) {
      case "youtrack":
        restParams.url = `issue/${comment.issueId}/comment/${comment.id}`
        restParams.query = {permanently: true}
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/comments/${comment.id}`
        break
    }

    // log ("DELETING", restParams)
    await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})

      // remove from store: orig and mirrors
  },

  updateMirror: async (entity: Entity, opts: Object = {}) => {
    if (webhookHandler.getIsComment (entity))
      await webhookHandler.updateMirrorComment (entity)
    else await webhookHandler.updateMirrorIssue (entity, opts)
  },

  updateMirrorComment: async (comment: IssueComment) => {
    await Promise.all (services.map (async (targetService) => {
      if (targetService === comment.service)
        return

      const knownIssueService: EntityService | void = {
        service: comment.service,
        id: comment.issueId,
      }
      const targetIssueService: EntityService | void = webhookHandler.getEntityService (knownIssueService, targetService)

      const knownCommentService: EntityService | void = {
        service: comment.service,
        id: comment.id,
        issueId: comment.issueId,
      }
      const targetCommentService: EntityService | void = webhookHandler.getEntityService (knownCommentService, targetService)

      // log ({targetService, knownIssueService, targetIssueService, knownCommentService, targetCommentService})

      if (!targetIssueService || ! targetCommentService)
        return

      const preparedComment: IssueComment = webhookHandler.getPreparedMirrorCommentForUpdate (comment, targetService)

      const restParams = {
        service: targetService,
      }

      switch (targetService) {
        case "youtrack":
          restParams.method = "put"
          restParams.url = `issue/${targetIssueService.id}/comment/${targetCommentService.id}`
          restParams.data = {text: preparedComment.body}
          break
        case "github":
          restParams.method = "patch"
          restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/comments/${targetCommentService.id}`
          restParams.data = {body: preparedComment.body}
          break
      }

      await integrationRest (restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})
    }))
  },

  getComments: async (sourceService: string, sourceIssueId: string): Array<IssueComment> => {
    const rawComments = await webhookHandler.getRawComments (sourceService, sourceIssueId)
    return rawComments.map ((rawComment) => webhookHandler.getFormatedComment (sourceService, rawComment, sourceIssueId))
  },

  getRawComments: async (sourceService: string, sourceIssueId: string): Array<Object> => {
    const restParams = {
      method: "get",
      service: sourceService,
    }

    switch (sourceService) {
      case "youtrack": {
        restParams.url = `issue/${sourceIssueId}/comment`
        break
      }
      case "github": {
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${sourceIssueId}/comments`
        break
      }
    }

    const comments = await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})

    return comments

  },

  getComment: async (knownEntityService: EntityService): IssueComment => {
    const restParams = {
      method: "get",
      service: knownEntityService.service,
    }

    switch (knownEntityService.service) {
      case "youtrack":
        restParams.url = `issue/${knownEntityService.issueId}/comment/`
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/comments/${knownEntityService.id}`
        break
    }

    let rawComment = await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})

    if (knownEntityService.service === "youtrack")
      rawComment = rawComment.filter ((f) => f.id === knownEntityService.id)[0]

    return webhookHandler.getFormatedComment (knownEntityService.service, rawComment, knownEntityService.issueId)
  },

  getFormatedComment: (service: string, rawComment: Object, issueId: string): IssueComment => {
    let body
    const formatedComment = {
      id: rawComment.id.toString(),
      service,
      issueId,
    }
    switch (service) {
      case "youtrack":
        body = rawComment.text
        formatedComment.author = rawComment.author
        break
      case "github":
        body = rawComment.body
        formatedComment.author = rawComment.user.login
        break
    }

    // replace \r with \n
    formatedComment.body = normalizeNewline (body)

    return formatedComment
  },

  getIssue: async (sourceService: string, issueId: string): Issue | void => {
    const restParams = {service: sourceService}

    switch (sourceService) {
      case "youtrack": {
        restParams.method = "get"
        restParams.url = `issue/${issueId}`
        break
      }
      case "github": {
        restParams.method = "get"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${issueId}`
        break
      }
    }

    const rawIssue = await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {
      // catch only if not found
      if (err.status !== 404)
        throw err
    })

    if (!rawIssue)
      return

    return webhookHandler.getFormatedIssue (sourceService, rawIssue)
  },

  getLabelsFromTags: (tags/*: Array<{name: string, value: string}>*/): Array<string> =>
    tags.map ((tag) => {
      if (tag !== "Star")
        return `Tag:${tag}`
    }).filter (Boolean),

  getLabelsFromFields: (fields/*: Array<{name: string, value: string}>*/): Array<string> =>
    fields.map ((field) =>
      // add here handles for field.specialAttr
       `${field.name}:${field.value}`),

  getFormatedIssue: (service: string, rawIssue: Object): Issue => {
    const issueId: string = webhookHandler.getIdFromRawIssue (service, rawIssue)

    switch (service) {
      case "github": {
        // TODO labels, how to display them on youtrack if source is github,
        // should fields be permitted to change from github if source is youtrack?

        const labels = rawIssue.labels.map ((l) => l.name)

        // filter duplicates, github bug sometimes creates duplicate label
        const uniqueLabels = labels.filter ((l, i) => labels.indexOf (l) === i)

        return {
          service,
          id: rawIssue.number.toString(),
          author: rawIssue.user.login,
          title: rawIssue.title,
          body: normalizeNewline (rawIssue.body),
          labels: uniqueLabels,
          state: webhookHandler.getStateFromRawIssue (service, rawIssue),
        }
      }
      case "youtrack": {
        let title = ""
        let body = ""
        const fields = []
        const parentFor = []
        const subtaskOf = []
        let author = ""

        rawIssue.field.forEach ((f) => {
          if (f.name === "summary")
            title = f.value
          else if (f.name === "description")
            body = normalizeNewline (f.value)
          else if (f.name === "reporterName")
            author = f.value
          else if (f.name === "links") {
            f.value.forEach ((l) => {
              if (l.type === "Subtask" && l.role === "subtask of")
                subtaskOf.push (l.value)
              else if (l.type === "Subtask" && l.role === "parent for")
                parentFor.push (l.value)
            })

          }
          else if (settings.fieldsToIncludeAsLabels.indexOf (f.name) !== -1)
            fields.push (f)
        })

        // log (service, webhookHandler.getStateFromRawIssue (service, rawIssue))

        const state = webhookHandler.getStateFromRawIssue (service, rawIssue)

        return {
          service,
          id: rawIssue.id,
          author,
          title,
          body,
          fields,
          parentFor,
          subtaskOf,
          state,
          rawComments: rawIssue.comment.filter ((c) => !c.deleted),
          tags: rawIssue.tag.map ((t) => t.value),
        }
      }
    }
  },

  getStateFromRawIssue: (service: string, rawIssue: Object) => {
    switch (service) {
      case "github": return rawIssue.state
      case "youtrack": {
        const stateFromField: string = rawIssue.field.filter ((f) => f.name === "State")[0].value[0]
        const a = settings.closedFieldStateValues.indexOf (stateFromField) !== -1
        return a ? "closed" : "open"
      }
    }

  },

  wrapStringToHtmlComment: (str: string): string => `<!--${str}-->`,

  getMeta: (entity: Entity): Object | void => {
    const metaRaw = webhookHandler.getMetaRaw (entity)

    if (!metaRaw)
      return

    return metaRaw
    /*
    // reattach youtrack project prefix
    if (metaRaw.id && metaRaw.service === "youtrack") {
      // only for issue.id and comment.issueId
      if (metaRaw.issueId) // is a comment
        metaRaw.issueId = webhookHandler.composeYoutrackId (metaRaw.issueId)
      // only comments have issueId, this is issue then
      else metaRaw.id = webhookHandler.composeYoutrackId (metaRaw.id)
    }
    return metaRaw
    */
  },

  getMetaRaw: (entity: Entity): Object | void => {
    const varStart = `<!--${mirrorMetaVarName}=`
    const varEnd = "-->"
    const regexStr = `${varStart}(.*)${varEnd}`
    const regexRE = entity.body.match(new RegExp(regexStr))
    if (regexRE && regexRE.length > 1)
      return JSON.parse(regexRE[1])
  },

  // todo, remove source service, use entity.service
  getMirrorSignature: (sourceService, targetService, entity: Entity): string => {
    // remove youtrack issue prefix as it's changable
    const {id, issueId} = entity

    // if service is youtrack
    /*
    if (entity.service === "youtrack") {
      // if is comment
      if (entity.issueId)
        issueId = webhookHandler.extractYoutrackId (entity.issueId)
      // else it is issue
      else id = webhookHandler.extractYoutrackId (entity.id)
    }
  */

    const entityMetaData = {
      service: sourceService,
      id,
      issueId,
    }

    return webhookHandler.getMetaAsIssueCommentHtmlComment (targetService, entityMetaData)
  },

  getMetaAsIssueCommentHtmlComment: (targetService: string, meta: Object) => {
    let entityHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (meta)}`)

    if (targetService === "youtrack")
      entityHtmlComment = `{html}${entityHtmlComment}{html}`

    return `\n\n${entityHtmlComment}`
  },

  updateMirrorIssue: async (sourceIssue: EntityService, opts: Object = {}) => {
    services.forEach (async (targetService) => {
      if (targetService === sourceIssue.service)
        return

      let targetEntityService: EntityService | void = webhookHandler.getEntityService (sourceIssue, targetService)

      // todo refactor, add updateIssue
      // this will be passed from createIssue to update state and labels right after creation
      const isPostCreation = opts.targetEntityService && opts.targetEntityService.service === targetService
      if (isPostCreation)
       targetEntityService = opts.targetEntityService

      if (!targetEntityService) {
        log (`no target (${targetService}) for (${sourceIssue.service}:${sourceIssue.id})`)
        return
      }

      const restParams = {service: targetEntityService.service}

      const preparedIssue: Issue = await webhookHandler.getPreparedMirrorIssueForUpdate (sourceIssue, targetService)

      const skipTitle = opts.skipTitle || isPostCreation
      const skipBody = opts.skipBody || isPostCreation

      switch (sourceIssue.service) {
        case "youtrack": {
          restParams.method = "patch"
          restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${targetEntityService.id}`

          restParams.data = {
            labels: preparedIssue.labels,
            state: preparedIssue.state,
          }
          if (!skipTitle) restParams.data.title = preparedIssue.title
          if (!skipBody) restParams.data.body = preparedIssue.body

          break
        }
        case "github": {
          if (!skipTitle || !skipBody) {
            restParams.method = "post"
            restParams.url = `issue/${targetEntityService.id}`
            restParams.query = {
              project: auth.youtrack.project,
            }
            if (!skipTitle) restParams.query.summary = preparedIssue.title
            if (!skipBody) restParams.query.description = preparedIssue.body
          }

          // todo: shoulnd't this override with "Open" every time.. 
          const applyStateParams = {
            service: targetEntityService.service,
            method: "post",
            url: `issue/${targetEntityService.id}/execute`,
            query: {
              command: `State ${preparedIssue.state === "open" ? "Open" : closedStateField}`,
            },
          }

          // apply new state
          await integrationRest(applyStateParams)
          .then ((response) => response.body)
          .catch ((err) => {throw err})

          break
        }
      }

      // if there is nothing to set
      if (sourceIssue.service === "github" && (skipTitle && skipBody))
        return

      return await integrationRest(restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})
    })

  },

  createMirrorComment: async (comment: IssueComment) => {
    await Promise.all (services.map (async (targetService) => {
      if (targetService === comment.service)
        return

      const knownIssueService: EntityService = {
        service: comment.service,
        id: comment.issueId,
      }
      const targetIssueService: EntityService | void = webhookHandler.getEntityService (knownIssueService, targetService)

      if (!targetIssueService) {
        log ("No comment issue found", {comment, targetService})
        throw "Error"
      }

      const preparedComment: IssueComment = webhookHandler.getPreparedMirrorCommentForUpdate (comment, targetService)

      await webhookHandler.createComment (preparedComment, targetService, targetIssueService.id)
    }))
  },

  createComment: async (comment: IssueComment, targetService: string, targetIssueId: string) => {
    const restParams = {
      service: targetService,
      method: "post",
    }

    switch (targetService) {
      case "youtrack":
        restParams.url = `issue/${targetIssueId}/execute`
        restParams.query = {
          comment: comment.body,
        }
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${targetIssueId}/comments`
        restParams.data = {
          body: comment.body,
        }
        break
    }

    await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})
  },

  getUniqueEntityServiceId: (entityService: EntityService): string =>
    [entityService.service, entityService.id, entityService.issueId].join ("_"),

  getEntityServiceFromUniqueId: (uniqueId: string): EntityService => {
    const split = uniqueId.split ("_")
    return {
      service: split[0],
      id: split[1],
      issueId: split[2],
    }
  },

  throwOnCreationRecursion: (entity: Entity) => {
    const id: string = webhookHandler.getUniqueEntityServiceId (entity)

    // throw if recently requested creation of same id
    if (recentlyCreatedIdsObj[id]) {
      log ("Recursion for creating".red, webhookHandler.entityLog (entity).yellow)
      throw "Possible recursion".red
    }
    // set creation flag
    recentlyCreatedIdsObj[id] = true
  },

  createMirror: async (entity: Entity) => {
    webhookHandler.throwOnCreationRecursion (entity)
    if (webhookHandler.getIsComment (entity))
      return await webhookHandler.createMirrorComment (entity)
    return await webhookHandler.createMirrorIssue (entity)
  },

  createMirrorIssue: async (sourceIssue: Issue) => {
    // eslint-disable-next-line no-undef
    /*if (process.env.ENV !== "test" && sourceIssue.service === "github") {
      log ("temporary disabled gh->yt")
      return
    }*/

    await Promise.all (services.map (async (targetService) => {
      if (targetService === sourceIssue.service)
        return

      const preparedIssue: Issue = webhookHandler.getPreparedMirrorIssueForUpdate (sourceIssue, targetService)

      await webhookHandler.createIssue (preparedIssue, targetService)
    }))

  },

  createIssue: async (issue: Issue, targetService: string): string => {
    const restParams = {service: targetService}

    switch (targetService) {
      case "github": {
        restParams.method = "post"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues`
        restParams.data = {
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
        }
        break
      }
      case "youtrack": {
        restParams.method = "put"
        restParams.url = "issue"
        restParams.query = {
          // todo: move to sourceIssue.project
          project: auth.youtrack.project,
          summary: issue.title,
          description: issue.body,
        }
        break
      }
    }

    // create issue and get its id
    const newIssueId: string = await integrationRest (restParams)
    .then ((response) => {
      switch (targetService) {
        case "github": {
          return response.body.number.toString ()
        }
        case "youtrack": {
          const loc: string = response.headers.location
          const indexOfLastSlash = loc.lastIndexOf ("/")
          return loc.substring (indexOfLastSlash + 1)
        }
      }
    })
    .catch ((err) => {throw err})

    // update fields/labels
    await webhookHandler.updateMirrorIssue (issue, {
      targetEntityService: {
        service: targetService,
        id: newIssueId,
      }
    })

    return newIssueId
  },

  projectExist: async (projName: string, targetService: string): boolean => {
    const restParams = {
      service: targetService,
      method: "get",
    }

    switch (targetService) {
      case "youtrack":
        restParams.url = `project/all`
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${projName}`
        break
    }

    const project = await integrationRest (restParams)
      .then ((response) => response.body)
      .catch ((err) => {
        if (err.status !== 404)
          throw err
      })

    if (!project)
      return false

    if (targetService === "github" && project.name.toLowerCase () !== projName.toLowerCase ())
      return false

    if (targetService === "youtrack" &&
      project.filter ((proj) => proj.shortName === projName).length === 0)
      return false

    return true
  },

  throwIfAnyProjectNotExist: async () => {
    await Promise.all (services.map (async (service) => {
      const projName = auth[service].project

      const projExist = await webhookHandler.projectExist (projName, service)
      if (!projExist)
        throw `Test ${service} repository|project not found: ${projName}`
    }))
  },

  generateRandomIssue: (service: string): Issue => {
    const issue: Issue = {
      id: Math.random ().toString (),
      title: Math.random ().toString (),
      body: Math.random ().toString (),
      service,
    }

    // switch (service) {} // fill additional

    return issue
  },

  generateRandomComment: (service: string): IssueComment => {
    const comment: IssueComment = {
      id: Math.random ().toString (),
      body: Math.random ().toString (),
      issueId: Math.random ().toString (),
      service,
    }

    // switch (service) {} // fill additional

    return comment
  },
}
