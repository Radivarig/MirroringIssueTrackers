import type {
  Issue,
  IssueComment,
  Entity,
  EntityService,
  EntityMapping,
} from './types'

import integrationRest from "./integrationRest"
import config from "../config/integration.config"

import {throwIfValueNotAllowed} from './helpers'

import Store from './Store'
const store = Store // new Store ()

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
  doInitialMapping: async () => {

    const issueAndComments: Array<{issue: Issue, comments: Array<IssueComment>}> = []

    await Promise.all (services.map (async (service) => {
      const projectIssues: Array<Issue> = await webhookHandler.getProjectIssues (service)

      await Promise.all (projectIssues.map (async (issue) => {
        webhookHandler.addIdToMapping (issue)

        const comments: Array<IssueComment> = await webhookHandler.getComments (issue.service, issue.id)
        comments.forEach (
          (comment) => webhookHandler.addIdToMapping (comment, true))

        issueAndComments.push ({
          issue,
          comments,
        })
      }))
    }))

    // iterate keys
    issueAndComments.map (async (m) => {
      console.log ("initial mapping", m)
      const {issue, comments} = m
      await webhookHandler.doMirror (issue.service, issue, comments)
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

  getIssueIdFromRequestBody: (sourceService: string, reqBody: Object): string => {
    if (sourceService === "youtrack") return reqBody.issueId.toString ()
    if (sourceService === "github") return reqBody.issue.number.toString ()
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

  addIdToMapping: (entity: Issue | IssueComment) => {
    // todo, babel typeof..
    const mappings = webhookHandler.getIsComment (entity) ? store.commentMappings : store.issueMappings

    if (webhookHandler.getIsOriginal (entity)) {
      const newEntityService: EntityService = {
        service: entity.service,
        id: entity.id,
      }
      mappings.add (newEntityService, undefined, {originalService: entity.service})
    }
    else {
      const meta = webhookHandler.getMeta (entity)

      const newEntityService: EntityService = {
        service: entity.service,
        id: entity.id,
      }
      const knownEntityService: EntityService = {
        service: meta.service,
        id: meta.id,
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

  doMirror: async (sourceService: string, entityOrId: string | Entity, comments: Array<IssueComment> | void) => {
    const sourceEntity: Entity = await webhookHandler.getEntityFromEntityOrId (sourceService, entityOrId)

    webhookHandler.addIdToMapping (sourceEntity)

    services.forEach (async (targetService) => {
      let targetEntity

      if (targetService === sourceService)
        targetEntity = sourceEntity
      else {
        const knownEntityService: EntityService = {
          service: sourceEntity.service,
          id: sourceEntity.id,
        }
        targetEntity = await webhookHandler.getTargetEntity (knownEntityService, targetService)
      }

      // if no target
      if (targetEntity === undefined) {
        // if original, create target mirror
        if (webhookHandler.getIsOriginal (sourceEntity)) {
          await webhookHandler.createMirror (sourceEntity)
          console.log (1, "creating mirror for", sourceEntity.id)
        }
        else {
          // todo delete
          // todo add flag deleted
          console.log (`Entity is a mirror without original: ${sourceService}, ${sourceEntity.id}`)
        }
      }
      // if target is found
      else {
        if (webhookHandler.getIsOriginal (targetEntity)) {
          // todo, skip if there is no change, add flag synced

          if (webhookHandler.getIsComment (targetEntity)) {
            console.log ("update comment TODO", targetEntity)
          }
          // this does not sync comments, comments are synced bellow
          else await webhookHandler.updateMirror (targetEntity)

          console.log (2, "is original", targetEntity.id) // this is triggered for originals, not mirrors
        }

        console.log (3, "after", targetEntity.id, comments) // this is triggered for original and mirrors

        // if entity is issue, sync comments
        if (webhookHandler.getIsComment (targetEntity) === false) {
          if (!comments)
            comments = await webhookHandler.getComments (targetEntity.service, targetEntity.id)

          await Promise.all (comments.map (
            async (comment) => await webhookHandler.doMirror (comment.service, comment)))
        }
      }
    })
  },

  handleRequest: async (service, req, res) => {
    // respond so that youtrack doesn't hang... (opened an issue about it)
    res.send ()

    throwIfValueNotAllowed (service, services)
    console.log (`Webhook from "${service}", action: ${req.body.action}`)

    const rb = req.body

    if (["created", "opened", "edited", "comments_changed"].indexOf (rb.action) !== -1) {
      const issueId: string = webhookHandler.getIssueIdFromRequestBody(service, rb)
      console.log ("on changes", service, issueId)
      await webhookHandler.doMirror (service, issueId)
    }

  },

  getIsComment: (entity: Issue | IssueComment): boolean => {
    try {const comment: IssueComment = entity}
    catch (err) {return false}
    return true
  },

  deleteComment: async (sourceService, reqBody: Object) => {
    if (sourceService === "github") {
      const targetService = "youtrack"

      // todo, get these in a more clean way
      const githubIssueId: string = reqBody.issue.number.toString ()
      const githubCommentId: string = reqBody.comment.id.toString ()

      console.log ({githubIssueId, githubCommentId})

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: githubIssueId,
      })

      const mirrorCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: githubCommentId,
      })

      const r = await integrationRest ({
        service: targetService,
        method: "delete",
        url: `issue/${mirrorId}/comment/${mirrorCommentId}`,
        query: {
          permanently: true,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))

      store.commentMappings.remove ({
        knownKey: sourceService,
        knownValue: githubCommentId,
      })
      store.commentMappings.remove ({
        knownKey: targetService,
        knownValue: mirrorCommentId,
      })

    }

    if (sourceService === "youtrack") {
      const targetService = "github"
      // bug in youtrack API, can't provide deleted comment id
      // get all comments from original, deleted is stored mirror not in that list

      // get youtrack comments
      const youtrackComments = await integrationRest ({
        service: sourceService,
        method: "get",
        url: `issue/${reqBody.id}/comment/`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))

      const youtrackCommentIds = youtrackComments.map ((m) => m.id.toString ())

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: reqBody.id,
      })

      // get github comments
      const githubComments = await integrationRest ({
        service: targetService,
        method: "get",
        url: `repos/${config.github.user}/${config.github.project}/issues/${mirrorId}/comments`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))

      const githubCommentIds = githubComments.map ((m) => m.id.toString ())

      githubCommentIds.forEach (async (githubCommentId) => {
        const youtrackCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
          key: sourceService,
          knownKey: targetService,
          knownValue: githubCommentId,
        })

        if (youtrackCommentIds.indexOf(youtrackCommentId) === -1) {
          const r = await integrationRest ({
            service: targetService,
            method: "delete",
            url: `repos/${config.github.user}/${config.github.project}/issues/comments/${githubCommentId}`,
          })
          .then ((response) => response.body)
          .catch ((err) => console.log ({status: err.status}))

          store.commentMappings.remove ({
            knownKey: sourceService,
            knownValue: youtrackCommentId,
          })
          store.commentMappings.remove ({
            knownKey: targetService,
            knownValue: githubCommentId,
          })

        }

      })

    }
  },

  updateMirrorComment: async (sourceService, issue: Issue, comment: IssueComment) => {
    if (sourceService === "youtrack") {
      const targetService = "github"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: issue.id,
      })

      const mirrorCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: comment.id,
      })

      const commentSignature = webhookHandler.getMirrorSignature (sourceService, targetService, issue, comment)

      return await integrationRest({
        service: targetService,
        method: "patch",
        url: `repos/${config.github.user}/${config.github.project}/issues/comments/${mirrorCommentId}`,
        data: {
          body: `${comment.body}\n\n${commentSignature}`,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }

    if (sourceService === "github") {
      const targetService = "youtrack"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: issue.id,
      })

      const mirrorCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: comment.id,
      })

      const commentSignature = webhookHandler.getMirrorSignature (sourceService, targetService, issue, comment)

      return await integrationRest ({
        service: targetService,
        method: "put",
        url: `issue/${mirrorId}/comment/${mirrorCommentId}`,
        data: {
          text: `${comment.body}\n\n${commentSignature}`,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }
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

    const a = webhookHandler.getFormatedComment (knownEntityService.service, rawComment, knownEntityService.issueId)
    console.log ("GET COMMENT", knownEntityService, a)
    return a
  },

  getFormatedComment: (service: string, rawComment: Object, issueId: string): IssueComment => {
    console.log ({rawComment})
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
      id: entity.id,
      service: sourceService,
    }

    const entityHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (entityMetaData)}`)

    if (targetService === "github")
      return entityHtmlComment

    if (targetService === "youtrack")
      return `{html}${entityHtmlComment}{html}`
  },

  updateMirror: async (sourceIssue: Issue) => {
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
