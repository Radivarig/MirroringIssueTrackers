import type {
  Issue,
  IssueComment,
  Entity,
  EntityService,
  EntityMapping,
} from './types'

import "colors"

import integrationRest from "./integrationRest"
import config from "../config/integration.config"

import {throwIfValueNotAllowed} from './helpers'

import Store from './Store'
let store

const mirrorMetaVarName = "MIRROR_META"

// === export to config
const fieldsToIncludeAsLabels = [
  "Priority",
  "State",
  "Type",
]

const services = ["github", "youtrack"]
// ===

export const webhookHandler = {
  getEntitiesWithOriginalsFirst: (sourceList: Array<Entity>): Array<Entity> => {
    const originals = []
    const mirrors = []

    sourceList.forEach ((entity) => {
      if (webhookHandler.getIsOriginal (entity))
        mirrors.push (entity)
      else originals.push (entity)
    })
    return originals.concat (mirrors)
  },

  doInitialMapping: async () => {
    store = new Store ()
    const issueAndCommentsList: Array<{issue: Issue, comments: Array<IssueComment>}> = []

    await Promise.all (services.map (async (service) => {
      const projectIssues: Array<Issue> = await webhookHandler.getProjectIssues (service)

      await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (projectIssues).map (async (issue) => {

        // filter to two arrays: then do originals first, mirrors second
        webhookHandler.addIdToMapping (issue)

        const comments: Array<IssueComment> = await webhookHandler.getComments (issue.service, issue.id)
        await Promise.all (webhookHandler.getEntitiesWithOriginalsFirst (comments).map (async (comment) => webhookHandler.addIdToMapping (comment)))

        issueAndCommentsList.push ({
          issue,
          comments,
        })
      }))
    }))

    // iterate keys
    issueAndCommentsList.map (async (m) => {
      const {issue, comments} = m
      console.log ("Initial mapping".grey, issue.id, comments && comments.map ((mm) => mm.id))
      await webhookHandler.doMirroring (issue.service, issue, comments)
    })
  },

  getProjectIssues: async (sourceService: string) => {
    const restParams = {
      service: sourceService,
      method: "get",
    }

    switch (sourceService) {
      case "youtrack":
        restParams.url = `issue/byproject/${config.youtrack.project}`
        break
      case "github":
        restParams.url = `repos/${config.github.user}/${config.github.project}/issues`
        restParams.data = {
          state: "open",// "all",
        }
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

  doMirroring: async (sourceService: string, entityOrId: string | Entity, comments: Array<IssueComment> | void) => {
    const sourceEntity: Entity = await webhookHandler.getEntityFromEntityOrId (sourceService, entityOrId)
    console.log ("Do mirroring".grey, sourceEntity.service, sourceEntity.id, ", comment:", webhookHandler.getIsComment (sourceEntity))

    webhookHandler.addIdToMapping (sourceEntity)

    await Promise.all (services.map (async (targetService) => {
      let targetEntity

      if (targetService === sourceService) {
        targetEntity = sourceEntity
      }
      else {
        const knownEntityService: EntityService = {
          service: sourceEntity.service,
          id: sourceEntity.id,
          issueId: sourceEntity.issueId,
        }
        targetEntity = await webhookHandler.getTargetEntity (knownEntityService, targetService)

        if (!targetEntity)
          console.log ("No target entity for".red, knownEntityService, targetService)
      }

      // if no target
      if (targetEntity === undefined) {
        // if original, create target mirror
        if (webhookHandler.getIsOriginal (sourceEntity)) {
          await webhookHandler.createMirror (sourceEntity)
          console.log ("Created mirror for".magenta, sourceEntity.service, sourceEntity.id)
        }
        else {
          // todo add flag deleted
          await webhookHandler.deleteEntity (sourceEntity)
          console.log ("Entity is a mirror without original, deleted".red, sourceService,sourceEntity.id,"comment: ", webhookHandler.getIsComment (sourceEntity))
        }
      }
      // if target is original
      else if (webhookHandler.getIsOriginal (targetEntity)) {
        // todo, skip if there is no change, add flag synced

        // this does not sync comments, comments are synced bellow
        console.log ("Update mirror".green, targetEntity.service, targetEntity.id)

        await webhookHandler.updateMirror (targetEntity)
      }
      else {
        console.log ("Skip mirror".cyan, targetEntity.service, targetEntity.id)
      }
    }))

    // if entity is issue, sync comments
    if (webhookHandler.getIsComment (sourceEntity) === false) {

      if (!comments)
        comments = await webhookHandler.getComments (sourceEntity.service, sourceEntity.id)

      await Promise.all (comments.map (
        async (comment) => await webhookHandler.doMirroring (comment.service, comment)))
    }

  },

  handleRequest: async (service, req, res) => {
    // respond so that youtrack doesn't hang... (opened an issue about it)
    res.send ()

    throwIfValueNotAllowed (service, services)
    console.log ("Webhook from".yellow, service, "action:", req.body.action)

    const rb = req.body

    if (["deleted", "created", "opened", "edited", "comments_changed"].indexOf (rb.action) !== -1) {
      const issueId: string | void = webhookHandler.getIssueIdFromRequestBody(service, rb)

      if (!issueId)
        return

      console.log ("Issue has changed".magenta, service, issueId)
      await webhookHandler.doInitialMapping ()

      // await webhookHandler.doMirroring (service, issueId)
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
    // todo: set title and body to empty and status to closed
    console.log ("deletion of issue not implemented", issue.service, issue.id)
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

    console.log ("DELETING", restParams)
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
      const commentBody = `${comment.body}\n\n${signature}`

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
    const formatedComment = {
      id: rawComment.id.toString(),
      service,
      issueId,
    }
    switch (service) {
      case "youtrack": formatedComment.body = rawComment.text; break
      case "github": formatedComment.body = rawComment.body; break
    }
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
          body: rawIssue.body,
          labels: [],
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
            body = f.value
          else if (fieldsToIncludeAsLabels.indexOf (f.name) !== -1)
            fields.push (f)
        })

        const labels = ["Mirror:Youtrack"].concat (webhookHandler.getLabelsFromFields (fields))

        return {
          service,
          id: rawIssue.id,
          title,
          body,
          labels,
        }
      }
    }
  },

  wrapStringToHtmlComment: (str: string): string => `<!--${str}-->`,

  getMeta: (issueOrComment: Issue | IssueComment): Object | void => {
    const varStart = `<!--${mirrorMetaVarName}=`
    const varEnd = "-->"
    const regexStr = `${varStart}(.*)${varEnd}`
    const regexRE = issueOrComment.body.match(new RegExp(regexStr))
    if (regexRE && regexRE.length > 1)
      return JSON.parse(regexRE[1])
  },

  getMirrorSignature: (sourceService, targetService, entity: Entity): string => {
    const entityMetaData = {
      service: sourceService,
      id: entity.id,
      issueId: entity.issueId,
    }

    const entityHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (entityMetaData)}`)

    if (targetService === "github")
      return entityHtmlComment

    if (targetService === "youtrack")
      return `{html}${entityHtmlComment}{html}`
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
      switch (sourceIssue.service) {
        case "youtrack": {
          restParams.method = "patch"
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${targetEntityService.id}`
          restParams.data = {
            title: sourceIssue.title,
            body: sourceIssue.body + webhookHandler.getMirrorSignature (sourceIssue.service, targetService, sourceIssue),
            labels: sourceIssue.labels,
          }
          break
        }
        case "github": {
          restParams.method = "post"
          restParams.url = `issue/${targetEntityService.id}`
          restParams.query = {
            // todo: move to sourceIssue.project
            project: config.youtrack.project,
            summary: sourceIssue.title,
            description: sourceIssue.body + webhookHandler.getMirrorSignature (sourceIssue.service, targetService, sourceIssue),
          }
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

      const signature: string = webhookHandler.getMirrorSignature (comment.service, targetService, comment)

      const restParams = {
        service: targetService,
        method: "post",
      }

      switch (targetService) {
        case "youtrack":
          restParams.url = `issue/${targetIssueService.id}/execute`
          restParams.query = {
            comment: `${comment.body}\n\n${signature}`,
          }
          break
        case "github":
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${targetIssueService.id}/comments`
          restParams.data = {
            body: `${comment.body}\n\n${signature}`,
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

      const signature: string = webhookHandler.getMirrorSignature (sourceIssue.service, targetService, sourceIssue)

      const restParams = {service: targetService}

      switch (targetService) {
        case "github": {
          restParams.method = "post"
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues`
          restParams.data = {
            title: sourceIssue.title,
            body: `${sourceIssue.body}\n\n${signature}`,
            labels: sourceIssue.labels,
          }
          break
        }
        case "youtrack": {
          restParams.method = "put"
          restParams.url = "issue"
          restParams.query = {
            // todo: move to sourceIssue.project
            project: config.youtrack.project,
            summary: sourceIssue.title,
            description: `${sourceIssue.body}\n\n${signature}`,
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
