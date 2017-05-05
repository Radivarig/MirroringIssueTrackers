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
    res.send ("doing stuff")
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
        const issueMeta = webhookHandler.getIssueMetaFromBody (issue.body)

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

      const mirrorCommentResponse = await webhookHandler.mirrorComment (service, issue, comment)
      console.log ({mirrorCommentResponse})
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

  getIssueMetaFromBody: (issueBody): Object | void => {
    const varStart = `<!--${mirrorMetaVarName}=`
    const varEnd = "-->"
    const regexStr = `${varStart}(.*)${varEnd}`
    const regexRE = issueBody.match(new RegExp(regexStr))
    if (regexRE && regexRE.length > 1)
      return JSON.parse(regexRE[1])
  },

  getIssueBody: (originService, targetService, issue: Issue) => {
    const issueMetaData = {
      id: issue.id,
      project: issue.project,
      service: originService,
    }

    const issueHtmlComment = webhookHandler.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (issueMetaData)}`
    )

    if (targetService === "github")
      return `${issue.body}\n\n${issueHtmlComment}`

    if (targetService === "youtrack")
      return `${issue.body}\n\n{html}${issueHtmlComment}{html}`
  },

  updateMirror: async (originService: string, issue: Issue) => {

    if (originService === "youtrack") {
      const targetService = "github"

      // todo: check if exists before accessing over index
      const mirrorId = tempStore.issueMappings.filter (
        (f) => f[originService] === issue.id
      )[0][targetService]

      return await integrationRest({
        service: targetService,
        method: "patch",
        url: `repos/${config.github.user}/${config.github.repo}/issues/${mirrorId}`,
        data: {
          title: issue.title,
          body: webhookHandler.getIssueBody (originService, targetService, issue),
        },
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
    }

    if (originService === "github") {
      const targetService = "youtrack"

      // todo: check if exists before accessing over index
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
          description: webhookHandler.getIssueBody (originService, targetService, issue),
        },
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
    }
  },

  mirrorComment: async (originService: string, issue: Issue, comment: IssueComment) => {
    if (originService === "youtrack") {
      throw "not implemented"

      const targetService = "github"

      return await integrationRest({
        service: targetService,
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
    }

    if (originService === "github") {
      const targetService = "youtrack"

      // todo: check if exists before accessing over index
      const mirrorId = tempStore.issueMappings.filter (
        (f) => f[originService] === issue.id
      )[0][targetService]

      return await integrationRest ({
        service: targetService,
        method: "post",
        url: `issue/${mirrorId}/execute`,
        query: {
          // todo: append mirror signature
          comment: comment.body,
        },
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
    }
  },

  createMirror: async (originService: string, issue: Issue) => {
    if (originService === "youtrack") {
      const targetService = "github"

      return await integrationRest({
        service: targetService,
        method: "post",
        url: `repos/${config.github.user}/${config.github.repo}/issues`,
        data: {
          title: issue.title,
          body: webhookHandler.getIssueBody (originService, targetService, issue),
        },
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)
    }

    if (originService === "github") {
      const targetService = "youtrack"

      return await integrationRest ({
        service: targetService,
        method: "put",
        url: "issue",
        query: {
          // todo: move to issue.project
          project: "GI",
          summary: issue.title,
          description: webhookHandler.getIssueBody (originService, targetService, issue),
        },
      })
      .catch ((err) => console.log ({err}))
      .then ((response) => response.body)

    }
  },

}
