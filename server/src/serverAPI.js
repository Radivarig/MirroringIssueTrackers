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

    console.log ({action: rb.action, issue})

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
        console.log ({createMirrorResponse})
      }
    }
    else if (rb.action === "edited") {
      // skip if mirror issue is edited
      if (issue.body.indexOf (mirrorMetaVarName) !== -1)
        return

      const r = await webhookHandler.updateMirror (service, issue)
      console.log ({updateMirrorResponse: r})
    }

    else if (rb.action === "created") {
      const comment = await webhookHandler.getComment (service, rb)

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
        console.log ({createMirrorCommentResponse: r})
      }
    }
  },

  getComment: async (service: string, reqBody: Object): IssueComment => {
    let rawComment

    console.log (service, reqBody.commentId)
    if (service === "youtrack") {
      const comments = await integrationRest ({
        service: "youtrack",
        method: "get",
        url: `issue/${reqBody.id}/comment`,
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)

      rawComment = comments.filter ((f) => f.id === reqBody.commentId)[0]
    }

    else if (service === "github") {
      // todo: also reqwuest comment by id
      rawComment = reqBody.comment
    }

    return webhookHandler.getFormatedComment (service, rawComment)
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

  getIssue: async (service: string, reqBody: Object): Issue => {
    let rawIssue

    if (service === "youtrack") {
      rawIssue = await integrationRest ({
        service: "youtrack",
        method: "get",
        url: `issue/${reqBody.id}`,
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
    }
    // todo: also request issue by id to get full info
    else if (service === "github") {
      rawIssue = reqBody.issue
    }

    return webhookHandler.getFormatedIssue (service, rawIssue)
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
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
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
          description: webhookHandler.getMirrorSignature (originService, targetService, issue),
        },
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
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

      // POST /repos/:owner/:repo/issues/:number/comments
      return await integrationRest({
        service: targetService,
        method: "post",
        url: `repos/${config.github.user}/${config.github.repo}/issues/${mirrorId}/comments`,
        data: {
          body: `${comment.body}\n\n${commentSignature}`,
        },
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
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
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
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
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
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
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)

    }
  },

}
