import type {
  Issue,
} from './types'

import integrationRest from "./integrationRest"
import config from "../config/integration.config"

export const handleWebhook = {
  async handleYoutrackRequest (req, res) {
    const rb = req.body
    console.log ("youtrack webhook", rb)

    // respond so that youtrack can create the issue, so that we can request it with full info
    res.send ()

    const rawIssue = await integrationRest ({
      service: "youtrack",
      method: "get",
      url: `issue/${rb.id}`,
    })
    .catch ((err) => console.log ({err}))
    .then ((response) => response.body)

    console.log ({rawIssue})
    const issue: Issue = handleWebhook.getters.youtrack.getFormatedIssue (rawIssue)

    const putIssueResponse = await integrationRest({
      service: "github",
      method: "post",
      url: `repos/${"config.github.user"}/${config.github.repo}/issues`,
      data: {
        title: issue.title,
        body: issue.body,
        // fill issue details
      },
    })
    .catch ((err) => console.log ({err}))
    .then ((response) => response.body)

    console.log ({putIssueResponse})
  },

  async handleGithubRequest (req, res) {
    const rb = req.body
    // console.log ("github webhook", rb.action)
    // todo: return to avoid loop, remember id to skip mirroring the mirror
    return
    if (rb.issue) {
      if (rb.action === "opened") {
        const issue: Issue = handleWebhook.getters.github.getFormatedIssue (rb.issue)
        // todo: link to original
        const signature = `{html}<a href=${"asdf"}>Open the original on GitHub</a>{html}`

        const putIssueResponse = await integrationRest ({
          service: "youtrack",
          method: "put",
          url: "issue",
          query: {
            project: "GI",
            summary: issue.title,
            description: `${issue.body}\n--\n${signature}`,
          },
        })
        .catch ((err) => console.log ({err}))
        .then ((response) => response.body)

        console.log ({putIssueResponse})
      }
    }
    // respond with empty
    res.send ()
  },

  getters: {
    github: {
      getFormatedIssue: (rawIssue: Object): Issue => ({
        id: rawIssue.number.toString(),
        title: rawIssue.title,
        body: rawIssue.body,
      }),
    },

    youtrack: {
      getFormatedIssue: (rawIssue: Object): Issue => ({
        id: rawIssue.id,
        title: rawIssue.field.filter((f) => f.name === "summary")[0].value,
        body: rawIssue.field.filter((f) => f.name === "description")[0].value,
      }),
    },
  },
}
