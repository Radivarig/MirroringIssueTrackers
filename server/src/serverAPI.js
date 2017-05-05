import type {
  Issue,
  IssueComment,
} from './types'

import integrationRest from "./integrationRest"
import config from "../config/integration.config"

import {throwIfValueNotAllowed} from './helpers'

const tempStore = {
  // {serviceName: stringId, serviceName2: stringId}
  // projectMappings: ..
  // issueMappings: [{"github": "44","youtrack": "GI-71"}],
  issueMappings: [],
  commentMappings: [],
}
// known: {serviceName: stringId}, {newService: stringId}
const addIssueMapping = ({knownService, knownId, newService, newId}) => {
  if (knownService === undefined) {
    const mapping = {}
    mapping[newService] = newId
    tempStore.issueMappings.push (mapping)
  }
  else {
    for (const mapping of tempStore.issueMappings) { // iterate array
      for (const service in mapping) { // iterate keys
        // if known service ids match
        if (service === knownService && mapping[service] === knownId)
          // horrible mutable adding new service and id
          mapping[newService] = newId
      }
    }
  }
}

const addCommentMapping = ({knownService, knownId, newService, newId}) => {
  if (knownService === undefined) {
    const mapping = {}
    mapping[newService] = newId
    tempStore.commentMappings.push (mapping)
  }
  else {
    for (const mapping of tempStore.commentMappings) { // iterate array
      for (const service in mapping) { // iterate keys
        // if known service ids match
        if (service === knownService && mapping[service] === knownId)
          // horrible mutable adding new service and id
          mapping[newService] = newId
      }
    }
  }
}

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
    res.send (JSON.stringify(tempStore, null, "\t"))
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

        addIssueMapping ({
          knownService: issueMeta.service,
          knownId: issueMeta.id,
          newService: service,
          newId: issue.id,
        })
      }
      else {
        addIssueMapping ({newService: service, newId: issue.id})

        // create mirror
        const createMirrorResponse = await webhookHandler.createMirror (service, issue)
        console.log ({createMirrorResponse})
      }
    }
    else if (rb.action === "edited") {
      // skip if mirror is edited
      if (issue.body.indexOf (mirrorMetaVarName) !== -1)
        return

      const updateMirrorResponse = await webhookHandler.updateMirror (service, issue)
      console.log ({updateMirrorResponse})
    }

    else if (rb.action === "created") {
      const comment = await webhookHandler.getComment (service, rb)

      // if this is the mirrored comment
      if (comment.body.indexOf (mirrorMetaVarName) !== -1) {
        const commentMeta = webhookHandler.getMetaFromBody (comment.body)

        addIssueMapping ({
          knownService: commentMeta.service,
          knownId: commentMeta.id,
          newService: service,
          newId: comment.id,
        })
      }
      else {
        addCommentMapping ({newService: service, newId: comment.id})

        const mirrorCommentResponse = await webhookHandler.mirrorComment (service, issue, comment)
        console.log ({mirrorCommentResponse})
      }
    }
  },

  getComment: async (service: string, reqBody: Object): IssueComment => {
    let rawComment

    if (service === "youtrack") {

    }
    else if (service === "github") {
      // todo: also reqwuest comment by id
      rawComment = reqBody.comment
    }

    return webhookHandler.getFormatedComment (service, rawComment)
  },

  getFormatedComment: (service: string, rawComment: Object) => {

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

      const mirrorId = tempStore.issueMappings.filter (
        (f) => f[originService] === issue.id
      )[0][targetService]

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

      const mirrorId = tempStore.issueMappings.filter (
        (f) => f[originService] === issue.id
      )[0][targetService]

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

  mirrorComment: async (originService: string, issue: Issue, comment: IssueComment) => {
    if (originService === "youtrack") {
      const targetService = "github"

      const mirrorId = tempStore.issueMappings.filter (
        (f) => f[originService] === issue.id
      )[0][targetService]

      return await integrationRest({
        service: targetService,
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
    }

    if (originService === "github") {
      const targetService = "youtrack"

      const mirrorId = tempStore.issueMappings.filter (
        (f) => f[originService] === issue.id
      )[0][targetService]

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
