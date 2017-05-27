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

import settings from "../config/settings.config"

import Store from './Store'
const store = new Store ()

let redoMirroring: boolean = false
let mirroringInProgress: boolean = false
let areIssuesMirrored: boolean = false

const recentlyCreatedIdsObj: Object = {}

let startTime
let keepTiming

const mirrorMetaVarName = "MIRROR_META"
const services = ["github", "youtrack"]

const log = (...args) => {
  console.log(...args) // eslint-disable-line no-console
}

export const webhookHandler = {
  handleRequest: async (service, req, res) => {
    // respond so that youtrack doesn't hang... (opened an issue about it)
    res.send ()
    const rb = req.body

    helpers.throwIfValueNotAllowed (service, services)
    log ("Webhook from".yellow, service, "action:".yellow, (rb.action || "").blue)

    if (["labeled", "unlabeled", "deleted", "created", "opened", "reopened", "closed", "edited", "comments_changed"].indexOf (rb.action) !== -1) {
      const issueId: string | void = webhookHandler.getIssueIdFromRequestBody(service, rb)

      if (!issueId)
        return

      log ("Changed issue:".yellow, service, issueId)
      await webhookHandler.initDoMirroring ()
    }

  },

  initDoMirroring: async () => {
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
      return
    }

    redoMirroring = false
    mirroringInProgress = true

    // clear store
    // store = new Store ()

    const allIssues: Array<Issue> = []
    const allComments: Array<IssueComment> = []

    // get all issues
    await Promise.all (services.map (async (service) => {
      const projectIssues: Array<Issue> = await webhookHandler.getProjectIssues (service)

      console.log ("Issues count", service, projectIssues.length)

      // filter
      allIssues.push (...projectIssues.filter ((issue) => {
        const isNotYoutrackBlacklisted = issue.service === "youtrack" && !webhookHandler.getIsIssueBlacklistedByTags (issue)
        const isNotNonYoutrackOriginal = issue.service !== "youtrack" && !webhookHandler.getIsOriginal (issue)
        return isNotYoutrackBlacklisted || isNotNonYoutrackOriginal
      }))
    }))

    // sort issue origs first, do ids mapping
    await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (allIssues).map (async (issue) => {
      // mapping sorted issues origs first
      const isMirror = webhookHandler.getIsOriginal (issue) === false
      // setting false to indicate that the mirror has been delivered
      webhookHandler.addToMapping (issue, isMirror ? {waitingForMirror: false} : {})
    }))

    const issuesWaitingForMirrors: Array<EntityService> = webhookHandler.getOriginalsWaitingForMirrors ()

    // check if there are originals waiting for mirrors
    if (issuesWaitingForMirrors.length > 0) {
      log ("Waiting webhook from mirrors of".blue, issuesWaitingForMirrors.map (
        (entityService) => webhookHandler.entityLog (entityService)).join (", "))
      mirroringInProgress = false
      keepTiming = true
      return
    }

    let areIssuesChanged = false

    if (areIssuesMirrored === false) {
      // call doSingleEntity one by one issue
      for (let i = 0; i < allIssues.length; ++i) {
        const issue = allIssues[i]

        log ("Initial mapping".grey, webhookHandler.entityLog (issue))
        const actionTaken: DoSingleEntityAction = await webhookHandler.doSingleEntity (issue)

        if (["created", "updated", "deleted"].indexOf (actionTaken) !== -1)
          areIssuesChanged = true

        if (actionTaken === "created")
          // setting true to indicate that the mirror has been requested
          webhookHandler.addToMapping (issue, {waitingForMirror: true})
      }
      // once no action has been taken on all issues
      areIssuesMirrored = areIssuesChanged === false

      log ("Loop on issues completed".grey, "restarting".blue)
      mirroringInProgress = false
      await webhookHandler.initDoMirroring ()
      return
    }

    if (allIssues.length === 0) {
      log ("No issues to mirror")
      mirroringInProgress = false

    }

    // get all comments
    await Promise.all (allIssues.map (async (issue) => {
      // fetching issue comments
      // todo take comments from issue
      const issueComments: Array<IssueComment> = await webhookHandler.getComments (issue.service, issue.id)
      allComments.push (...issueComments)

      // adding as property to call doSingleEntity for comments at once on all issues
      issue.comments = issueComments
    }))

    // sort comment origs first, do ids mapping
    await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (allComments).map (async (comment) => {
      // mapping sorted comments origs first
      webhookHandler.addToMapping (comment)
    }))

    // call doSingleEntity for comments of every issue
    await Promise.all (allIssues.map (async (issue) => {
      for (let i = 0; i < issue.comments.length; ++i) {
        const comment: IssueComment = issue.comments[i]

        const actions = ["created", "deleted", "updated", "skipped_equal"]

        const {lastChange} = webhookHandler.getEntityServiceMapping (comment)

        // skip this if we already made action on this comment
        if (actions.indexOf (lastChange) !== -1) {
          log ("Skip already addressed comment".grey, webhookHandler.entityLog (comment), lastChange.grey)
        }
        else {
          const actionTaken: DoSingleEntityAction = await webhookHandler.doSingleEntity (comment)

          if (actions.indexOf (actionTaken) !== -1)
            webhookHandler.addToMapping (comment, {lastChange: actionTaken})

          if (actionTaken === "created") {
            webhookHandler.logWaitingForWebhook (comment)
            mirroringInProgress = false
            // break for the order of comments, can't add multiple comments on single issue at once
            break
          }
        }
      }
    }))

    mirroringInProgress = false
    if (redoMirroring) {
      log ("Received webhook during last run".grey, "restarting".blue)
      await webhookHandler.initDoMirroring ()
    }
    else if (!keepTiming) {
      log ("Done", webhookHandler.getFormatedTimeFromStart ().yellow)
      startTime = undefined
    }
  },

  // call doSingleEntity from doMirroring only
  // returns a string of action taken
  doSingleEntity: async (entity: Entity): DoSingleEntityAction  => {
    // todo use await Promise.all (services.map (async (targetService) => { doSingleEntity (targetService)
    // instead getOtherEntity from inside

    // if original
    if (webhookHandler.getIsOriginal (entity)) {
      const mirrorEntity: Entity | void = await webhookHandler.getOtherEntity (entity)

      // if has mirror
      if (mirrorEntity) {
        // skip if equal
        if (webhookHandler.getIsOriginalEqualToMirror (entity, mirrorEntity)) {
          log ("Skip updating equal mirror of".grey, webhookHandler.entityLog (entity))
          return "skipped_equal"
        }

        // update if not equal
        log ("Update mirror ".green + webhookHandler.entityLog (mirrorEntity),
          "of".green, webhookHandler.entityLog (entity))

        await webhookHandler.updateMirror (entity)
        return "updated"
      }

      log ("Create mirror of".magenta, webhookHandler.entityLog (entity))
      await webhookHandler.createMirror (entity)
        // return true to indicate a change that will redo doMapping
      return "created"
    }
    // else is mirror

    const origEntity: Entity | void = await webhookHandler.getOtherEntity (entity)

      // if has original
    if (origEntity) {
        // nothing, original will be called from doMirroring
      log ("Skip mirror".grey, webhookHandler.entityLog (entity),
        "of".grey, webhookHandler.entityLog (origEntity))
      return "skipped_mirror"
    }

        // delete
    log ("Deleting mirror".red, webhookHandler.entityLog (entity))
    await webhookHandler.deleteEntity (entity)
        // return to indicate a change that will redo doMapping
    return "deleted"
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

  logWaitingForWebhook: (entity: Entity) => {
    keepTiming = true
    log ("Waiting for webhook after action related to".blue, webhookHandler.entityLog (entity).yellow)
    /*
    gotWebhook = false
    setTimeout (() => {
      if (gotWebhook === false)
        throw `Timeout${webhookHandler.getFormatedTimeFromStart ()}`
    }, 30000)
    */

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

  getProjectIssues: async (sourceService: string) => {
    switch (sourceService) {
      case "youtrack": {
        const query = {max: 10000}
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
        const allMirroringQuery = {
          state: "all",
          // labels: "Mirroring",
          per_page: 100,
        }
        return await webhookHandler.getProjectIssuesRaw (sourceService, allMirroringQuery)
      }
    }
  },

  composeYoutrackId: (id: string): string => `${auth.youtrack.project}-${id}`,
  extractYoutrackId: (fullId: string): string => fullId.split("-")[1],

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
    const rawIssues = await integrationRest (restParams)
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

  getTargetEntity: async (knownEntityService: EntityService, targetService: string): Entity | void => {

    const targetEntityService: EntityService | void = webhookHandler.getEntityService (knownEntityService, targetService)

    if (!targetEntityService)
      return

    if (targetEntityService.issueId)
      return await webhookHandler.getComment (targetEntityService)

    return await webhookHandler.getIssue (targetEntityService.service, targetEntityService.id)
  },

  getIsOriginal: (issueOrComment: Issue | IssueComment): boolean =>
    issueOrComment.body.indexOf (mirrorMetaVarName) === -1,

  addToMapping: (entity: Entity, assign: Object = {}) => {
    // todo, babel typeof..
    const mappings = webhookHandler.getIsComment (entity) ? store.commentMappings : store.issueMappings

    if (webhookHandler.getIsOriginal (entity)) {
      mappings.add (entity, undefined, {
        originalService: entity.service,
        ...assign,
      })
    }
    else {
      const meta = webhookHandler.getMeta (entity)

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

  getIsIssueBlacklistedByTags: (issue: Issue): boolean => {
    // if issue not from youtrack
    if (!issue.tags)
      return false

    const issueTags: Array<string> = issue.tags.map ((t) => t.value)

      // if tags contain force mirroring tag
    if (issueTags.indexOf (settings.forceMirroringTag) !== -1)
      return false

      // if intersection
    for (let i = 0; i < issueTags.length; ++i) {
      const tag: string = issueTags[i]

      if (settings.mirroringBlacklistTags.indexOf (tag) !== -1) {
        log ("Issue is blacklisted for mirroring".grey, webhookHandler.entityLog (issue))
        return true
      }
    }
    // no intersection
    return false
  },

  getOtherEntity: async (sourceEntity: Entity): Entity | void => {
    let targetService

    switch (sourceEntity.service) {
      case "github": targetService = "youtrack"; break
      case "youtrack": targetService = "github"; break
    }

    const knownEntityService: EntityService = sourceEntity
    return await webhookHandler.getTargetEntity (knownEntityService, targetService)
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

  getPreparedMirrorIssueForUpdate: (issue: Issue, targetService: string): Entity => {
    // todo, switch (issue.service) instead
    let labels = issue.fields || issue.tags ? ["Mirroring"] : undefined
    if (issue.fields)
      labels = labels.concat (webhookHandler.getLabelsFromFields (issue.fields))
    if (issue.tags)
      labels = labels.concat (webhookHandler.getLabelsFromTags (issue.tags))

    const hierarchy = webhookHandler.getHierarchyStringBlock (issue)
    const signature = webhookHandler.getMirrorSignature (issue.service, targetService, issue)

    return {
      ...issue,
      body: issue.body + hierarchy + signature,
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

  getIsOriginalEqualToMirror: (originalEntity: Entity, mirrorEntity: Entity): boolean => {
    const signature = webhookHandler.getMirrorSignature (originalEntity.service, mirrorEntity.service, originalEntity)
    if (webhookHandler.getIsComment (originalEntity)) {
      return originalEntity.body + signature === mirrorEntity.body
    }

    const preparedOriginal: Issue = webhookHandler.getPreparedMirrorIssueForUpdate (originalEntity, mirrorEntity.service)

    const areLabelsEqual = webhookHandler.doListsContainSameElements (
      preparedOriginal.labels || [], mirrorEntity.labels || [])

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

  updateMirror: async (entity: Entity) => {
    if (webhookHandler.getIsComment (entity))
      await webhookHandler.updateMirrorComment (entity)
    else await webhookHandler.updateMirrorIssue (entity)
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

      const signature: string = webhookHandler.getMirrorSignature (comment.service, targetService, comment)

      const restParams = {
        service: targetService,
      }
      const commentBody = `${comment.body}${signature}`

      switch (targetService) {
        case "youtrack":
          restParams.method = "put"
          restParams.url = `issue/${targetIssueService.id}/comment/${targetCommentService.id}`
          restParams.data = {text: commentBody}
          break
        case "github":
          restParams.method = "patch"
          restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/comments/${targetCommentService.id}`
          restParams.data = {body: commentBody}
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

    if(knownEntityService.service === "youtrack")
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
      case "youtrack": body = rawComment.text; break
      case "github": body = rawComment.body; break
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
    tags.map ((tag) =>
      // add here handles for field.specialAttr
       `Tag:${tag.value}`),

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

        rawIssue.field.forEach ((f) => {
          if (f.name === "summary")
            title = f.value
          else if (f.name === "description")
            body = normalizeNewline (f.value)
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
          title,
          body,
          fields,
          parentFor,
          subtaskOf,
          state,
          tags: rawIssue.tag,
        }
      }
    }
  },

  getStateFromRawIssue: (service: string, rawIssue: Object) => {
    switch (service) {
      case "github": return rawIssue.state
      case "youtrack": {
        const stateFromField: string = rawIssue.field.filter ((f) => f.name === "State")[0].value[0]
        const a = settings.closedStateFields.indexOf (stateFromField) !== -1
        return a ? "closed" : "open"
      }
    }

  },

  wrapStringToHtmlComment: (str: string): string => `<!--${str}-->`,

  getMeta: (entity: Entity): Object | void => {
    const metaRaw = webhookHandler.getMetaRaw (entity)

    if (!metaRaw)
      return

    // reattach youtrack project prefix
    if (metaRaw.id && metaRaw.service === "youtrack") {
      // only for issue.id and comment.issueId
      if (metaRaw.issueId) // is a comment
        metaRaw.issueId = webhookHandler.composeYoutrackId (metaRaw.issueId)
      // only comments have issueId, this is issue then
      else metaRaw.id = webhookHandler.composeYoutrackId (metaRaw.id)
    }
    return metaRaw
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
    let {id, issueId} = entity

    // if service is youtrack
    if (entity.service === "youtrack") {
      // if is comment
      if (entity.issueId)
        issueId = webhookHandler.extractYoutrackId (entity.issueId)
      // else it is issue
      else id = webhookHandler.extractYoutrackId (entity.id)
    }

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

  updateMirrorIssue: async (sourceIssue: Issue) => {

    services.forEach (async (targetService) => {
      if (targetService === sourceIssue.service)
        return

      const knownEntityService: EntityService = {
        service: sourceIssue.service,
        id: sourceIssue.id,
      }
      const targetEntityService: EntityService | void = webhookHandler.getEntityService (knownEntityService, targetService)

      if (!targetEntityService) {
        log (`no target (${targetService}) for (${sourceIssue.service}:${sourceIssue.id})`)
        return
      }

      const restParams = {service: targetEntityService.service}

      const preparedIssue: Issue = await webhookHandler.getPreparedMirrorIssueForUpdate (sourceIssue, targetService)

      switch (sourceIssue.service) {
        case "youtrack": {
          restParams.method = "patch"
          restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${targetEntityService.id}`

          restParams.data = {
            title: preparedIssue.title,
            body: preparedIssue.body,
            labels: preparedIssue.labels,
            state: preparedIssue.state,
          }
          break
        }
        case "github": {
          restParams.method = "post"
          restParams.url = `issue/${targetEntityService.id}`
          restParams.query = {
            // todo: move to sourceIssue.project
            project: auth.youtrack.project,
            summary: preparedIssue.title,
            description: preparedIssue.body,
          }

          const applyStateParams = {
            service: targetEntityService.service,
            method: "post",
            url: `issue/${targetEntityService.id}/execute`,
            query: {
              // TODO move this to config and allow custom youtrack state field string for from UI
              command: `State ${preparedIssue.state === "open" ? "Open" : "Verified"}`,
            },
          }

          // apply new state
          await integrationRest(applyStateParams)
          .then ((response) => response.body)
          .catch ((err) => {throw err})

          break
        }
      }

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

      const signature: string = webhookHandler.getMirrorSignature (comment.service, targetService, comment)

      const restParams = {
        service: targetService,
        method: "post",
      }

      switch (targetService) {
        case "youtrack":
          restParams.url = `issue/${targetIssueService.id}/execute`
          restParams.query = {
            comment: `${comment.body}${signature}`,
          }
          break
        case "github":
          restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${targetIssueService.id}/comments`
          restParams.data = {
            body: `${comment.body}${signature}`,
          }
          break
      }

      await integrationRest (restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})
    }))
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
    if (sourceIssue.service === "github") {
      console.log ("temporary disabled gh->yt")
      return
    }

    await Promise.all (services.map (async (targetService) => {
      if (targetService === sourceIssue.service)
        return

      const preparedIssue: Issue = webhookHandler.getPreparedMirrorIssueForUpdate (sourceIssue, targetService)

      const restParams = {service: targetService}

      switch (targetService) {
        case "github": {
          restParams.method = "post"
          restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues`
          restParams.data = {
            title: preparedIssue.title,
            body: preparedIssue.body,
            // github bug, creates multiple same labels
            // labels: preparedIssue.labels,
          }
          break
        }
        case "youtrack": {
          restParams.method = "put"
          restParams.url = "issue"
          restParams.query = {
            // todo: move to sourceIssue.project
            project: auth.youtrack.project,
            summary: preparedIssue.title,
            description: preparedIssue.body,
          }
          break
        }
      }

      await integrationRest (restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})

    }))

  },

}
