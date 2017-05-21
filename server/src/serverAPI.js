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
  doInitialMapping: async () => {
    const issuesObj = {}

    for (let i = 0; i < services.length; ++i) {
      const service = services[i]
      issuesObj[service] = await webhookHandler.getProjectIssues (service)

      // recreate id mappings
      for (let j = 0; j < issuesObj[service].length; ++j) {
        const issue = issuesObj[service][j]

        webhookHandler.addIssueIdToMapping (service, issue)
      }
    }

    // iterate keys
    for (const service in issuesObj) {
      for (let i = 0; i < issuesObj[service].length; ++i) {
        const issue = issuesObj[service][i]
        // sync
        await webhookHandler.doMirror(service, issue)
      }
    }

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
      const issue = await webhookHandler.getFormatedIssue (sourceService, rawIssue)
      issues.push (issue)
    }
    return issues
  },

  doStuff: async (req, res) => {
    res.send (`<pre>${JSON.stringify(store, null, "    ")}</pre>`)
  },

  getIssueIdFromRequestBody: (sourceService: string, reqBody: Object): string => {
    if (sourceService === "youtrack")
      return reqBody.issueId.toString ()
    if (sourceService === "github")
      return reqBody.issue.number.toString ()
  },

  getTargetId: (sourceService: string, sourceId: string, targetService: string): string | void =>
    store.issueMappings.getValueByKeyAndKnownKeyValue ({
      key: targetService,
      knownKey: sourceService,
      knownValue: sourceId,
    }),

  getTargetIssue: async (sourceService: string, sourceId: string, targetService: string): Issue | void => {
    const targetId: string | void = webhookHandler.getTargetId (sourceService, sourceId, targetService)

    if (!targetId)
      return

    return await webhookHandler.getIssue (targetService, targetId)
  },

  getIsIssueOriginal: (issue: Issue): boolean => issue.body.indexOf (mirrorMetaVarName) === -1,

  addIssueIdToMapping: (sourceService: string, issue: Issue) => {
    if (webhookHandler.getIsIssueOriginal (issue)) {
      store.issueMappings.add ({
        newKey: sourceService,
        newValue: issue.id,
        assign: {
          original: sourceService,
        },
      })
    }
    else {
      const issueMeta = webhookHandler.getIssueMeta (issue)

      // create mapping to original
      store.issueMappings.add ({
        knownKey: issueMeta.service,
        knownValue: issueMeta.id,
        newKey: sourceService,
        newValue: issue.id,
        assign: {
          original: issueMeta.service,
        },
      })
    }
  },

  doMirror: async (sourceService: string, issueOrId: string | Issue) => {
    const sourceIssue: Issue = await webhookHandler.getIssueFromIssueOrId (sourceService, issueOrId)

    webhookHandler.addIssueIdToMapping (sourceService, sourceIssue)

    services.forEach (async (targetService) => {
      let targetIssue

      if (targetService === sourceService)
        targetIssue = sourceIssue
      else
        targetIssue = await webhookHandler.getTargetIssue (sourceService, sourceIssue.id, targetService)

      // if no target
      if (targetIssue === undefined) {
        // if original, create target mirror
        if (webhookHandler.getIsIssueOriginal(sourceIssue)) {
          await webhookHandler.createMirror (sourceService, sourceIssue)
        }
        else {
          // todo delete
          // todo add flag deleted
          console.log (`Issue is a mirror without original: ${sourceService}, ${sourceIssue.id}`)
        }
      }
      // if target is found
      else {
        if (webhookHandler.getIsIssueOriginal (targetIssue)) {
          // todo, skip if there is no change, add flag synced

          // this does not sync comments, see below
          await webhookHandler.updateMirror (targetService, targetIssue)
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

      const commentSignature = webhookHandler.getMirrorCommentSignature (sourceService, targetService, issue, comment)

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

      const commentSignature = webhookHandler.getMirrorCommentSignature (sourceService, targetService, issue, comment)

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

  getIssueFromIssueOrId: async (service, issueOrId: string | Issue): Issue => {
    if (typeof issueOrId === "string")
      return await webhookHandler.getIssue (service, issueOrId)

    return issueOrId
  },

  getComment: async (sourceService: string, reqBody: Object): IssueComment => {
    let rawComment

    if (sourceService === "youtrack") {
      const comments = await integrationRest ({
        service: sourceService,
        method: "get",
        url: `issue/${reqBody.id}/comment/`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
      rawComment = comments.filter ((f) => f.id === reqBody.commentId)[0]
    }

    else if (sourceService === "github") {
      rawComment = await integrationRest ({
        service: sourceService,
        method: "get",
        url: `repos/${config.github.user}/${config.github.project}/issues/comments/${reqBody.comment.id}`,
      })
      .then ((response) => response.body)

    }

    return webhookHandler.getFormatedComment (sourceService, rawComment)
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

    return rawIssue && webhookHandler.getFormatedIssue (sourceService, rawIssue)
  },

  getLabelsFromFields: (fields/*: Array<{name: string, value: string}>*/): Array<string> =>
    fields.map ((field) =>
      // add here handles for field.specialAttr
       `${field.name}:${field.value}`),

  getFormatedIssue: (sourceService: string, rawIssue: Object): Issue => {
    if (sourceService === "github") {
      // TODO labels, how to display them on youtrack if source is github,
      // should fields be permitted to change from github if source is youtrack?

      return {
        id: rawIssue.number.toString(),
        title: rawIssue.title,
        body: rawIssue.body,
        labels: [],
      }
    }
    if (sourceService === "youtrack") {
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

  getMirrorCommentSignature: (sourceService, targetService, issue: Issue, comment: IssueComment) => {
    const commentMetaData = {
      id: comment.id,
      //project: issue.project,
      service: sourceService,
    }

    const commentHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (commentMetaData)}`)

    if (targetService === "github")
      return commentHtmlComment

    if (targetService === "youtrack")
      return `{html}${commentHtmlComment}{html}`
  },

  getMirrorSignature: (sourceService, targetService, issue: Issue) => {
    const issueMetaData = {
      id: issue.id,
      // project: issue.project,
      service: sourceService,
    }

    const issueHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (issueMetaData)}`)

    if (targetService === "github")
      return issueHtmlComment

    if (targetService === "youtrack")
      return `{html}${issueHtmlComment}{html}`
  },

  updateMirror: async (sourceService: string, issue: Issue) => {
    services.forEach (async (targetService) => {
      if (targetService === sourceService)
        return

      const targetId: string = webhookHandler.getTargetId (sourceService, issue.id, targetService)

      const restParams = {service: targetService}
      switch (sourceService) {
        case "youtrack": {
          restParams.method = "patch"
          restParams.url = `repos/${config.github.user}/${config.github.project}/issues/${targetId}`
          restParams.data = {
            title: issue.title,
            body: issue.body + webhookHandler.getMirrorSignature (sourceService, targetService, issue),
            labels: issue.labels,
          }
          break
        }
        case "github": {
          restParams.method = "post"
          restParams.url = `issue/${targetId}`
          restParams.query = {
            // todo: move to issue.project
            project: config.youtrack.project,
            summary: issue.title,
            description: issue.body + webhookHandler.getMirrorSignature (sourceService, targetService, issue),
          }
          break
        }
      }

      return await integrationRest(restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})
    })

  },

  createMirrorComment: async (sourceService: string, issue: Issue, comment: IssueComment) => {
    if (sourceService === "youtrack") {
      const targetService = "github"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: sourceService,
        knownValue: issue.id,
      })

      const commentSignature: string = webhookHandler.getMirrorCommentSignature (sourceService, targetService, issue, comment)

      return await integrationRest({
        service: targetService,
        method: "post",
        url: `repos/${config.github.user}/${config.github.project}/issues/${mirrorId}/comments`,
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

      const commentSignature: string = webhookHandler.getMirrorCommentSignature (sourceService, targetService, issue, comment)
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

  createMirror: async (sourceService: string, issue: Issue) => {
    if (sourceService === "youtrack") {
      const targetService = "github"

      const signature: string = webhookHandler.getMirrorSignature (sourceService, targetService, issue)

      return await integrationRest({
        service: targetService,
        method: "post",
        url: `repos/${config.github.user}/${config.github.project}/issues`,
        data: {
          title: issue.title,
          body: `${issue.body}\n\n${signature}`,
          labels: issue.labels,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }

    if (sourceService === "github") {
      const targetService = "youtrack"

      const signature: string = webhookHandler.getMirrorSignature (sourceService, targetService, issue)
      return await integrationRest ({
        service: targetService,
        method: "put",
        url: "issue",
        query: {
          // todo: move to issue.project
          project: config.youtrack.project,
          summary: issue.title,
          description: `${issue.body}\n\n${signature}`,
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))

    }
  },

}
