import type {
  Issue,
} from './types'

import integrationRest from "./integrationRest"
import config from "../config/integration.config"

import {throwIfValueNotAllowed} from './helpers'

const mirrorMetaVarName = "MIRROR_META"

export const webhookHandler = {
  handleRequest: async (service, req, res) => {
    // respond so that youtrack doesn't hang (todo, solve in workflow)
    res.send ()

    throwIfValueNotAllowed (service, ["github", "youtrack"])

    const rb = req.body
    console.log (`Webhook from "${service}"`)

    const issue: Issue = await webhookHandler.getIssue (service, rb)

    console.log ({action: rb.action, issue})

    // if this is the mirrored issue, return
    if (issue.body.indexOf (mirrorMetaVarName) !== -1)
      return

    if (rb.action === "opened") {
      const createNewIssueResponse = await webhookHandler.createNewIssue (service, issue)
      console.log ({createNewIssueResponse})
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

/*
  getIssueMeta: (issue: Issue) => ({
    id: issue.id,
    // created time,
    // last modified time,
    // author,
    // project,
    // origin,
  }),

  getIssueMetaAsHtmlComment: (issue: Issue): string => {
    return webhookHandler.wrapStringToHtmlComment (JSON.stringify (webhookHandler.getIssueMeta))
  },
*/

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

  createNewIssue: async (originService: string, issue: Issue) => {
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
