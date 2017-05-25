import type {
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
import config from "../config/integration.config"

import {throwIfValueNotAllowed} from './helpers'

import Store from './Store'
let store

let redoMirroring: boolean = false
let mirroringInProgress: boolean = false

const mirrorMetaVarName = "MIRROR_META"

// === export to config
const fieldsToIncludeAsLabels = [
  "Priority",
  "State",
  "Type",
]

const services = ["github", "youtrack"]

// note: field values are case sensitive
const closedStateFields = [
  "Can't Reproduce",
  "Duplicate",
  "Fixed",
  "Won't fix",
  "Incomplete",
  "Obsolete",
  "Verified",
]

// note: tags are lowercase
const mirroringBlacklistTags = [
  "topsecret",
  "verysecurity",
  "muchpasswords",
  "suchcrypto",
]
const forceMirroringTag = "forcemirroring"
// ===

export const webhookHandler = {
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

  getProjectIssues: async (sourceService: string) => {
    switch (sourceService) {
      case "youtrack":
        return await webhookHandler.getProjectIssuesRaw (sourceService)
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
        const allMirroringQuery = {state: "all", labels: "Mirroring"}
        return await webhookHandler.getProjectIssuesRaw (sourceService, allMirroringQuery)
      }

    }

  },

  composeYoutrackId: (id: string): string => `${config.youtrack.project}-${id}`,
  extractYoutrackId: (fullId: string): string => fullId.split("-")[1],

  getProjectIssuesRaw: async (sourceService: string, query: Object | void) => {
    const restParams = {
      service: sourceService,
      method: "get",
      query,
    }

    switch (sourceService) {
      case "youtrack":
        restParams.url = `issue/byproject/${config.youtrack.project}`
        break
      case "github":
        restParams.url = `repos/${config.github.user}/${config.github.project}/issues`
        break
    }

    const rawIssues = await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})

    const issues = []
    for (let i = 0; i < rawIssues.length; ++i) {
      const rawIssue = rawIssues[i]
      issues.push (webhookHandler.getFormatedIssue (sourceService, rawIssue))
    }
    return issues
  },

  doStuff: async (req, res) => {
    res.send (`<pre>${JSON.stringify(store, null, "    ")}</pre>`)
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
    const mappings = knownEntityService.issueId ?
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

  addIdToMapping: (entity: Entity) => {
    // todo, babel typeof..
    const mappings = webhookHandler.getIsComment (entity) ? store.commentMappings : store.issueMappings

    const newEntityService: EntityService = {
      service: entity.service,
      id: entity.id,
      issueId: entity.issueId,
      body: entity.body,
    }
    if (webhookHandler.getIsOriginal (entity)) {
      mappings.add (newEntityService, undefined, {originalService: entity.service})
    }
    else {
      const meta = webhookHandler.getMeta (entity)

      const knownEntityService: EntityService = {
        service: meta.service,
        id: meta.id,
        issueId: meta.issueId,
      }
      // create mapping to original
      mappings.add (newEntityService, knownEntityService, {originalService: meta.service})
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

  // fetch all issues and comments,
  // sort originals first then mirrors,
  // map IDs in that order,
  // call doSingleEntity for each issue,
  // for each issue, call doSingleEntity for all comments,

  doMirroring: async () => {
    if (mirroringInProgress) {
      redoMirroring = true
      return
    }

    redoMirroring = false
    mirroringInProgress = true

    // clear store
    store = new Store ()

    const allIssues: Array<Issue> = []
    const allComments: Array<IssueComment> = []

    // get all issues
    await Promise.all (services.map (async (service) => {
      const projectIssues: Array<Issue> = await webhookHandler.getProjectIssues (service)
      allIssues.push (...projectIssues.filter (webhookHandler.getIsIssueBlacklistedByTags))
    }))

    // sort issue origs first, do ids mapping, get comments
    await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (allIssues).map (async (issue) => {
      // mapping sorted issues origs first
      webhookHandler.addIdToMapping (issue)
    }))

    // call doSingleEntity for every issue
    const doSingleEntityResponses = []
    await Promise.all (allIssues.map (async (issue) => {
      console.log ("Initial mapping".grey, webhookHandler.entityLog (issue))
      const r: DoSingleEntityAction = await webhookHandler.doSingleEntity (issue)
      doSingleEntityResponses.push (r)
    }))

    // todo, use if and avoid
    if (allIssues.length === 0) {
      console.log ("No issues found")
      mirroringInProgress = false
      return
    }

    // restart doMirroring if issues were removed or created
    const shouldAbort = doSingleEntityResponses.reduce ((a, b) => {
      const abortOnStrings = ["created", "deleted"]
      return (abortOnStrings.indexOf (a) !== -1 || abortOnStrings.indexOf (b) !== -1)
    })
    if (shouldAbort) {
      console.log ("Issues added or removed, aborting and waiting for webhook".blue)
    }
    else {
      // else if no issues have been removed or created, proceede to comments

      // get all comments
      await Promise.all (allIssues.map (async (issue) => {
        // fetching issue comments
        const issueComments: Array<IssueComment> = await webhookHandler.getComments (issue.service, issue.id)
        allComments.push (...issueComments)

        // adding as property to call doSingleEntity for comments at once on all issues
        issue.comments = issueComments
      }))

      // sort comment origs first, do ids mapping
      await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (allComments).map (async (comment) => {
        // mapping sorted comments origs first
        webhookHandler.addIdToMapping (comment)
      }))

      // call doSingleEntity for comments of every issue
      await Promise.all (allIssues.map (async (issue) => {
        for (let i = 0; i < issue.comments.length; ++i) {
          const comment: IssueComment = issue.comments[i]
          const r: DoSingleEntityAction = await webhookHandler.doSingleEntity (comment)
          if (r === "created") {
            console.log ("Comment created, aborting and waiting for webhook".blue)
            // this is for the order of comments, can't add multiple comments on single issue at once
            break
          }
        }
      }))
    }

    mirroringInProgress = false
    if (redoMirroring)
      webhookHandler.initDoMirroring ()
    else console.log ("Done")
  },

  getIsIssueBlacklistedByTags: (issue: Issue): boolean => {
    // if issue not from youtrack
    if (!issue.tags)
      return true

    const issueTags: Array<string> = issue.tags.map ((t) => t.value)

      // if tags contain force mirroring tag
    if (issueTags.indexOf (forceMirroringTag) !== -1)
      return true

      // if intersection
    for (let i = 0; i < issueTags.length; ++i) {
      const tag: string = issueTags[i]

      if (mirroringBlacklistTags.indexOf (tag) !== -1) {
        console.log ("Issue is blacklisted for mirroring", webhookHandler.entityLog (issue))
        return false
      }
    }
      // no intersection
    return true
  },

  initDoMirroring: async () => {
    await webhookHandler.doMirroring ()
    /*
    .catch ((err) => {
      const ts = 10000
      console.log (`doMirroring error, restarting in ${ts}`.red, err)
      setTimeout (() => {
        // retry in ts
        webhookHandler.doMirroring ()
      }, ts)
    })
    */
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

  // call doSingleEntity from doMirroring only
  // returns string of action taken
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
          console.log ("Skip updating equal mirror of".grey, webhookHandler.entityLog (entity))
          return "skipped_equal"
        }

          // update if not equal
        console.log ("Update mirror ".green + webhookHandler.entityLog (mirrorEntity),
          "of".green, webhookHandler.entityLog (entity))

        webhookHandler.updateMirror (entity)
        return "updated"

      }

        // create mirror
      console.log ("Create mirror of".green, webhookHandler.entityLog (entity))
      webhookHandler.createMirror (entity)
        // return true to indicate a change that will redo doMapping
      return "created"

    }
    // else is mirror

    const origEntity: Entity | void = await webhookHandler.getOtherEntity (entity)

      // if has original
    if (origEntity) {
        // nothing, original will be called from doMirroring
      console.log ("Skip mirror".grey, webhookHandler.entityLog (entity),
        "of".grey, webhookHandler.entityLog (origEntity))
      return "skipped_mirror"
    }

        // delete
    console.log ("Deleting mirror".red, webhookHandler.entityLog (entity))
    webhookHandler.deleteEntity (entity)
        // return to indicate a change that will redo doMapping
    return "deleted"

  },

  getPreparedMirrorIssueForUpdate: (issue: Issue, targetService: string): Entity => {
    // todo, check for services instead &&
    let labels = issue.fields || issue.tags ? ["Mirroring"] : undefined
    if (issue.fields)
      labels = labels.concat (webhookHandler.getLabelsFromFields (issue.fields))
    if (issue.tags)
      labels = labels.concat (webhookHandler.getLabelsFromTags (issue.tags))

    const signature = webhookHandler.getMirrorSignature (issue.service, targetService, issue)

    return {
      ...issue,
      body: issue.body + signature,
      labels,
    }
  },

  doListsContainSameElements: (listA: Array, listB: Array): boolean => {
    if (listA.length !== listB.length)
      return false

    return (
      listA.filter ((a) => listB.indexOf (a) === -1).length === 0 &&
      listB.filter ((b) => listA.indexOf (b) === -1).length === 0
    )
  },

  getIsOriginalEqualToMirror: (originalEntity: Entity, mirrorEntity: Entity): boolean => {
    const signature = webhookHandler.getMirrorSignature (originalEntity.service, mirrorEntity.service, originalEntity)
    if (webhookHandler.getIsComment (originalEntity)) {
      return originalEntity.body + signature === mirrorEntity.body
    }

    const preparedOriginal: Issue = webhookHandler.getPreparedMirrorIssueForUpdate (originalEntity, mirrorEntity.service)

    // detect labels change
    const areLabelsEqual = webhookHandler.doListsContainSameElements (
      preparedOriginal.labels || [], mirrorEntity.labels || [])

    //console.log ({preparedOriginal, mirrorEntity, areLabelsEqual})
    return (
      preparedOriginal.title === mirrorEntity.title &&
      preparedOriginal.body === mirrorEntity.body &&
      preparedOriginal.state === mirrorEntity.state &&
      areLabelsEqual)
  },

  entityLog: (entity: Entity): string => {
    const parts = []
    parts.push (entity.service.yellow)
    parts.push (entity.id.yellow)
    if (webhookHandler.getIsComment (entity))
      parts.push ("(comment)".grey)
    return parts.join (" ")
  },

  handleRequest: async (service, req, res) => {
    // respond so that youtrack doesn't hang... (opened an issue about it)
    res.send ()

    throwIfValueNotAllowed (service, services)
    console.log ("Webhook from".yellow, service.underline, "action:".yellow, req.body.action.blue)

    const rb = req.body

    if (["labeled", "deleted", "created", "opened", "reopened", "closed", "edited", "comments_changed"].indexOf (rb.action) !== -1) {
      const issueId: string | void = webhookHandler.getIssueIdFromRequestBody(service, rb)

      if (!issueId)
        return

      console.log ("Changed issue:".yellow, service, issueId)
      await webhookHandler.initDoMirroring ()
    }

  },

  getIsComment: (entity: Issue | IssueComment): boolean => {
    try {const comment: IssueComment = entity}
    catch (err) {return false}
    return true
  },

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
        restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${issue.id}`
        restParams.data = data

        return await integrationRest(restParams)
        .then ((response) => response.body)
        .catch ((err) => {throw err})
      }
      // case "youtrack": // Github issues cannot be deleted, so noop
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
        restParams.url = `repos/${config.github.user}/${config.github.project}/issues/comments/${comment.id}`
        break
    }

    // console.log ("DELETING", restParams)
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

      // console.log ({targetService, knownIssueService, targetIssueService, knownCommentService, targetCommentService})

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
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues/comments/${targetCommentService.id}`
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
        restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${sourceIssueId}/comments`
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
        restParams.url = `repos/${config.github.user}/${config.github.project}/issues/comments/${knownEntityService.id}`
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
        restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${issueId}`
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

        return {
          service,
          id: rawIssue.number.toString(),
          title: rawIssue.title,
          body: normalizeNewline (rawIssue.body),
          labels: rawIssue.labels.map ((l) => l.name),
          state: webhookHandler.getStateFromRawIssue (service, rawIssue),
        }
      }
      case "youtrack": {
        let title = ""
        let body = ""
        const fields = []

        rawIssue.field.forEach ((f) => {
          if (f.name === "summary")
            title = f.value
          else if (f.name === "description")
            body = normalizeNewline (f.value)
          else if (fieldsToIncludeAsLabels.indexOf (f.name) !== -1)
            fields.push (f)
        })

        // console.log (service, webhookHandler.getStateFromRawIssue (service, rawIssue))

        const state = webhookHandler.getStateFromRawIssue (service, rawIssue)

        return {
          service,
          id: rawIssue.id,
          title,
          body,
          fields,
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
        const a = closedStateFields.indexOf (stateFromField) !== -1
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
        console.log (`no target (${targetService}) for (${sourceIssue.service}:${sourceIssue.id})`)
        return
      }

      const restParams = {service: targetEntityService.service}

      const preparedIssue: Issue = await webhookHandler.getPreparedMirrorIssueForUpdate (sourceIssue, targetService)

      switch (sourceIssue.service) {
        case "youtrack": {
          restParams.method = "patch"
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${targetEntityService.id}`

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
            project: config.youtrack.project,
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
        console.log ("solve this error", {comment, targetService})
        return
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
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${targetIssueService.id}/comments`
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

  createMirror: async (entity: Entity) => {
    if (webhookHandler.getIsComment (entity))
      return await webhookHandler.createMirrorComment (entity)
    return await webhookHandler.createMirrorIssue (entity)
  },

  createMirrorIssue: async (sourceIssue: Issue) => {
    services.forEach (async (targetService) => {
      if (targetService === sourceIssue.service)
        return

      const preparedIssue: Issue = webhookHandler.getPreparedMirrorIssueForUpdate (sourceIssue, targetService)

      const restParams = {service: targetService}

      switch (targetService) {
        case "github": {
          restParams.method = "post"
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues`
          restParams.data = {
            title: preparedIssue.title,
            body: preparedIssue.body,
            labels: preparedIssue.labels,
          }
          break
        }
        case "youtrack": {
          restParams.method = "put"
          restParams.url = "issue"
          restParams.query = {
            // todo: move to sourceIssue.project
            project: config.youtrack.project,
            summary: preparedIssue.title,
            description: preparedIssue.body,
          }
          break
        }
      }

      await integrationRest (restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})
    })
  },

}
