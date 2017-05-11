import type {
  Issue,
  IssueComment,
} from './types'

import integrationRest from "./integrationRest"
import config from "../config/integration.config"

import {throwIfValueNotAllowed} from './helpers'

import Store from './Store'
const store = new Store ()

const mirrorMetaVarName = "MIRROR_META"

export const webhookHandler = {
  doStuff: async (req, res) => {
    /*
    const response = await integrationRest ({
      service: "github",
      method: "get",
      url: `issue/`,
    })
    .then ((r) => r.body)
    .catch ((err) => console.log ({err_status: err.status, err}))
    */
    res.send (`<pre>${JSON.stringify(store, null, "    ")}</pre>`)
  },

  handleRequest: async (service, req, res) => {
    // respond so that youtrack doesn't hang (todo, solve in workflow)
    res.send ()

    throwIfValueNotAllowed (service, ["github", "youtrack"])

    const rb = req.body
    console.log (`Webhook from "${service}"`)
    const issue: Issue = await webhookHandler.getIssue (service, rb)

    console.log ({action: rb.action, "issue.id": issue.id, hasComment: rb.comment !== undefined})

    if (rb.action === "opened") {
      // if this is the mirrored issue
      if (issue.body.indexOf (mirrorMetaVarName) !== -1) {
        const issueMeta = webhookHandler.getMetaFromBody (issue.body)

        // create mapping with original issue
        store.issueMappings.add ({
          knownKey: issueMeta.service,
          knownValue: issueMeta.id,
          newKey: service,
          newValue: issue.id,
        })
      }
      else {
        // expand mapping with mirror issue
        store.issueMappings.add ({newKey: service, newValue: issue.id})

        // create mirror issue
        const createMirrorResponse = await webhookHandler.createMirror (service, issue)
      }
    }
    else if (rb.action === "edited") {
      if (rb.comment) {
        const comment: IssueComment = await webhookHandler.getComment (service, rb)

        // skip if mirror issue is edited
        if (comment.body.indexOf (mirrorMetaVarName) !== -1)
          return

        const r = await webhookHandler.updateMirrorComment (service, issue, comment)
      }
      // issue
      else {
        // skip if mirror issue is edited
        if (issue.body.indexOf (mirrorMetaVarName) !== -1)
          return

        const r = await webhookHandler.updateMirror (service, issue)
      }
    }

    else if (rb.action === "created") {
      const comment: IssueComment = await webhookHandler.getComment (service, rb)

      // if this is the mirrored comment
      if (comment.body.indexOf (mirrorMetaVarName) !== -1) {
        const commentMeta = webhookHandler.getMetaFromBody (comment.body)

        // create mapping with original comment
        store.commentMappings.add ({
          knownKey: commentMeta.service,
          knownValue: commentMeta.id,
          newKey: service,
          newValue: comment.id,
        })
      }
      else {
        // expand mapping with mirror comment
        store.commentMappings.add ({newKey: service, newValue: comment.id})

        const r = await webhookHandler.createMirrorComment (service, issue, comment)
      }
    }
    else if (rb.action === "deleted") {
      if (rb.comment) {
        const r = await webhookHandler.deleteComment (service, rb)
      }
      // issue
      else {
        // only youtrack can delete, for github:
          // change title to <deleted>
          // set body to empty string
          // close issue
          // remove all comments
      }
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

  getIssue: async (originService: string, reqBody: Object): Issue => {
    let rawIssue

    if (originService === "youtrack") {
      const issueId = reqBody.id
      rawIssue = await integrationRest ({
        service: originService,
        method: "get",
        url: `issue/${issueId}`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }
    else if (originService === "github") {
      const issueId = reqBody.issue.number
      rawIssue = await integrationRest ({
        service: originService,
        method: "get",
        url: `repos/${config.github.user}/${config.github.repo}/issues/${issueId}`,
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }

    return webhookHandler.getFormatedIssue (originService, rawIssue)
  },

  getFormatedIssue: (service: string, rawIssue: Object): Issue => {
    if (service === "github") {
      return {
        id: rawIssue.number.toString(),
        title: rawIssue.title,
        body: rawIssue.body,
      }
    }
    if (service === "youtrack") {
      return {
        id: rawIssue.id,
        title: rawIssue.field.filter((f) => f.name === "summary")[0].value,
        body: rawIssue.field.filter((f) => f.name === "description")[0].value,
      }
    }
  },

  wrapStringToHtmlComment: (str: string): string => `<!--${str}-->`,

  getMetaFromBody: (issueBody): Object | void => {
    const varStart = `<!--${mirrorMetaVarName}=`
    const varEnd = "-->"
    const regexStr = `${varStart}(.*)${varEnd}`
    const regexRE = issueBody.match(new RegExp(regexStr))
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
    if (originService === "youtrack") {
      const targetService = "github"

      const mirrorId = store.issueMappings.getValueByKeyAndKnownKeyValue ({
        key: targetService,
        knownKey: originService,
        knownValue: issue.id,
      })

      return await integrationRest({
        service: targetService,
        method: "patch",
        url: `repos/${config.github.user}/${config.github.repo}/issues/${mirrorId}`,
        data: {
          title: issue.title,
          body: issue.body + webhookHandler.getMirrorSignature (originService, targetService, issue),
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

      return await integrationRest ({
        service: targetService,
        method: "post",
        url: `issue/${mirrorId}`,
        query: {
          // todo: move to issue.project
          project: "GI",
          summary: issue.title,
          description: issue.body + webhookHandler.getMirrorSignature (originService, targetService, issue),
        },
      })
      .then ((response) => response.body)
      .catch ((err) => console.log ({status: err.status}))
    }
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
