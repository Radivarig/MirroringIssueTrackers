import type {
  Issue,
  IssueComment,
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
  doStuff: async (req, res) => {
    res.send (`<pre>${JSON.stringify(store, null, "    ")}</pre>`)
  },

  getIssueIdFromRequestBody: (originService: string, reqBody: Object): string => {
    if (originService === "youtrack")
      return reqBody.issueId.toString ()
    if (originService === "github")
      return reqBody.issue.number.toString ()
  },

  getTargetId: (originService: string, originId: string, targetService: string): string | void =>
    store.issueMappings.getValueByKeyAndKnownKeyValue ({
      key: targetService,
      knownKey: originService,
      knownValue: originId,
    }),

  getTargetIssue: async (originService: string, originId: string, targetService: string): Promise<Issue | void> => {
    const targetId: string | void = webhookHandler.getTargetId (originService, originId, targetService)
    return await targetId && webhookHandler.getIssue (targetService, targetId)
  },

  getIsIssueOriginal: (issue: Issue): boolean => issue.body.indexOf (mirrorMetaVarName) === -1,

  addIssueIdToMapping (originService: string, issue: Issue) {
    if (webhookHandler.getIsIssueOriginal (issue)) {
      store.issueMappings.add ({newKey: originService, newValue: issue.id})
    }
    else {
      const issueMeta = webhookHandler.getIssueMeta (issue)

      // create mapping to original
      store.issueMappings.add ({
        knownKey: issueMeta.service,
        knownValue: issueMeta.id,
        newKey: originService,
        newValue: issue.id,
      })
    }
  },

  doMirror: async (originService: string, originId: string) => {
    const issue: Issue = await webhookHandler.getIssue (originService, originId)

    webhookHandler.addIssueIdToMapping (originService, issue)

    services.forEach (async (targetService) => {
      if (targetService === originService)
        return

      const targetIssue: Issue | void = await webhookHandler.getTargetIssue (originService, originId, targetService)

      // if no target
      if (targetIssue === undefined) {
        // if original, create target mirror
        if (webhookHandler.getIsIssueOriginal(issue)) {
          await webhookHandler.createMirror (originService, issue)
        }
        else {
          // todo delete
          throw `issue is a mirror without original${issue.id}`
        }
      }
      // if target is found
      else {
        if (webhookHandler.getIsIssueOriginal (issue)) {
          // this does not sync comments, see below
          await webhookHandler.updateMirror (originService, targetIssue)
        }

        // loop comments of source
        // if sourceComment, update targetComments
        // if targetComment, update it with fetched sourceComment
        // if no sourceComment for targetComment, delete targetComment
      }

    })
  },

  handleRequest: async (service, req, res) => {
    // respond so that youtrack doesn't hang... (opened an issue about it)
    res.send ()

    throwIfValueNotAllowed (service, services)
    console.log (`Webhook from "${service}", action: ${req.body.action}`)

    const rb = req.body

    if (["opened", "edited", "comments_changed"].indexOf (rb.action) !== -1) {
      const issueId: string = webhookHandler.getIssueIdFromRequestBody(service, rb)
      await webhookHandler.doMirror (service, issueId)
    }

  },

  deleteComment: async (originService, reqBody: Object) => {
    if (originService === "github") {
      const targetService = "youtrack"

      // todo, get these in a more clean way
      const githubIssueId: string = reqBody.issue.number.toString ()
      const githubCommentId: string = reqBody.comment.id.toString ()

      console.log ({githubIssueId, githubCommentId})

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: githubIssueId,
      })

      const mirrorCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
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
        knownKey: originService,
        knownValue: githubCommentId,
      })
      store.commentMappings.remove ({
        knownKey: targetService,
        knownValue: mirrorCommentId,
      })

    }

    if (originService === "youtrack") {
      const targetService = "github"
      // bug in youtrack API, can't provide deleted comment id
      // get all comments from original, deleted is stored mirror not in that list

      // get youtrack comments
      const youtrackComments = await integrationRest ({
        service: originService,
        method: "get",
        url: `issue/${reqBody.id}/comment/`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))

      const youtrackCommentIds = youtrackComments.map ((m) => m.id.toString ())

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: reqBody.id,
      })

      // get github comments
      const githubComments = await integrationRest ({
        service: targetService,
        method: "get",
        url: `repos/${config.github.user}/${config.github.repo}/issues/${mirrorId}/comments`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))

      const githubCommentIds = githubComments.map ((m) => m.id.toString ())

      githubCommentIds.forEach (async (githubCommentId) => {
        const youtrackCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
          key: originService,
          knownKey: targetService,
          knownValue: githubCommentId,
        })

        if (youtrackCommentIds.indexOf(youtrackCommentId) === -1) {
          const r = await integrationRest ({
            service: targetService,
            method: "delete",
            url: `repos/${config.github.user}/${config.github.repo}/issues/comments/${githubCommentId}`,
          })
          .then ((response) => response.body)
          .catch ((err) => console.log ({status: err.status}))

          store.commentMappings.remove ({
            knownKey: originService,
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

  updateMirrorComment: async (originService, issue: Issue, comment: IssueComment) => {
    if (originService === "youtrack") {
      const targetService = "github"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: issue.id,
      })

      const mirrorCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: comment.id,
      })

      const commentSignature = webhookHandler.getMirrorCommentSignature (originService, targetService, issue, comment)

      return await integrationRest({
        service: targetService,
        method: "patch",
        url: `repos/${config.github.user}/${config.github.repo}/issues/comments/${mirrorCommentId}`,
        data: {
          body: `${comment.body}\n\n${commentSignature}`,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }

    if (originService === "github") {
      const targetService = "youtrack"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: issue.id,
      })

      const mirrorCommentId = store.commentMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: comment.id,
      })

      const commentSignature = webhookHandler.getMirrorCommentSignature (originService, targetService, issue, comment)

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

  getComment: async (originService: string, reqBody: Object): IssueComment => {
    let rawComment

    if (originService === "youtrack") {
      const comments = await integrationRest ({
        service: originService,
        method: "get",
        url: `issue/${reqBody.id}/comment/`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
      rawComment = comments.filter ((f) => f.id === reqBody.commentId)[0]
    }

    else if (originService === "github") {
      rawComment = await integrationRest ({
        service: originService,
        method: "get",
        url: `repos/${config.github.user}/${config.github.repo}/issues/comments/${reqBody.comment.id}`,
      })
      .then ((response) => response.body)

    }

    return webhookHandler.getFormatedComment (originService, rawComment)
  },

  getFormatedComment: (service: string, rawComment: Object) => {
    if (service === "youtrack") {
      return {
        id: rawComment.id.toString(),
        body: rawComment.text,
      }
    }

    if (service === "github") {
      return {
        id: rawComment.id.toString(),
        body: rawComment.body,
      }
    }
  },

  getIssue: async (originService: string, issueId: string): Issue | void => {
    const restParams = {service: originService}

    switch (originService) {
      case "youtrack": {
        restParams.method = "get"
        restParams.url = `issue/${issueId}`
        break
      }
      case "github": {
        restParams.method = "get"
        restParams.url = `repos/${config.github.user}/${config.github.repo}/issues/${issueId}`
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

    return rawIssue && webhookHandler.getFormatedIssue (originService, rawIssue)
  },

  getLabelsFromFields: (fields/*: Array<{name: string, value: string}>*/): Array<string> =>
    fields.map ((field) =>
      // add here handles for field.specialAttr
       `${field.name}:${field.value}`),

  getFormatedIssue: (originService: string, rawIssue: Object): Issue => {
    if (originService === "github") {
      // TODO labels, how to display them on youtrack if origin is github,
      // should fields be permitted to change from github if origin is youtrack?

      return {
        id: rawIssue.number.toString(),
        title: rawIssue.title,
        body: rawIssue.body,
        labels: [],
      }
    }
    if (originService === "youtrack") {
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
        id: rawIssue.id,
        title,
        body,
        labels,
      }
    }
  },

  wrapStringToHtmlComment: (str: string): string => `<!--${str}-->`,

  getIssueMeta: (issue: Issue): Object | void => {
    const varStart = `<!--${mirrorMetaVarName}=`
    const varEnd = "-->"
    const regexStr = `${varStart}(.*)${varEnd}`
    const regexRE = issue.body.match(new RegExp(regexStr))
    if (regexRE && regexRE.length > 1)
      return JSON.parse(regexRE[1])
  },

  getMirrorCommentSignature: (originService, targetService, issue: Issue, comment: IssueComment) => {
    const commentMetaData = {
      id: comment.id,
      //project: issue.project,
      service: originService,
    }

    const commentHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (commentMetaData)}`)

    if (targetService === "github")
      return commentHtmlComment

    if (targetService === "youtrack")
      return `{html}${commentHtmlComment}{html}`
  },

  getMirrorSignature: (originService, targetService, issue: Issue) => {
    const issueMetaData = {
      id: issue.id,
      // project: issue.project,
      service: originService,
    }

    const issueHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (issueMetaData)}`)

    if (targetService === "github")
      return issueHtmlComment

    if (targetService === "youtrack")
      return `{html}${issueHtmlComment}{html}`
  },

  updateMirror: async (originService: string, issue: Issue) => {
    services.forEach (async (targetService) => {
      if (targetService === originService)
        return

      const targetId: string = webhookHandler.getTargetId (originService, issue.id, targetService)

      const restParams = {service: targetService}

      switch (originService) {
        case "youtrack": {
          restParams.method = "patch"
          restParams.url = `repos/${config.github.user}/${config.github.repo}/issues/${targetId}`
          restParams.data = {
            title: issue.title,
            body: issue.body + webhookHandler.getMirrorSignature (originService, targetService, issue),
            labels: issue.labels,
          }
          break
        }
        case "github": {
          restParams.method = "post"
          restParams.url = `issue/${targetId}`
          restParams.query = {
            // todo: move to issue.project
            project: "GI",
            summary: issue.title,
            description: issue.body + webhookHandler.getMirrorSignature (originService, targetService, issue),
          }
          break
        }
      }

      return await integrationRest(restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})
    })

  },

  createMirrorComment: async (originService: string, issue: Issue, comment: IssueComment) => {
    if (originService === "youtrack") {
      const targetService = "github"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: issue.id,
      })

      const commentSignature: string = webhookHandler.getMirrorCommentSignature (originService, targetService, issue, comment)

      return await integrationRest({
        service: targetService,
        method: "post",
        url: `repos/${config.github.user}/${config.github.repo}/issues/${mirrorId}/comments`,
        data: {
          body: `${comment.body}\n\n${commentSignature}`,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }

    if (originService === "github") {
      const targetService = "youtrack"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: issue.id,
      })

      const commentSignature: string = webhookHandler.getMirrorCommentSignature (originService, targetService, issue, comment)
      return await integrationRest ({
        service: targetService,
        method: "post",
        url: `issue/${mirrorId}/execute`,
        query: {
          // todo: append mirror signature
          comment: `${comment.body}\n\n${commentSignature}`,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }
  },

  createMirror: async (originService: string, issue: Issue) => {
    if (originService === "youtrack") {
      const targetService = "github"

      const signature: string = webhookHandler.getMirrorSignature (originService, targetService, issue)

      return await integrationRest({
        service: targetService,
        method: "post",
        url: `repos/${config.github.user}/${config.github.repo}/issues`,
        data: {
          title: issue.title,
          body: `${issue.body}\n\n${signature}`,
          labels: issue.labels,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }

    if (originService === "github") {
      const targetService = "youtrack"

      const signature: string = webhookHandler.getMirrorSignature (originService, targetService, issue)
      return await integrationRest ({
        service: targetService,
        method: "put",
        url: "issue",
        query: {
          // todo: move to issue.project
          project: "GI",
          summary: issue.title,
          description: `${issue.body}\n\n${signature}`,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))

    }
  },

}
