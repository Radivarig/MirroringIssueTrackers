import type {
  User,
  Repository,
  Issue,
} from './types'

import request from 'superagent'
import youtrackRest from "./youtrackRest"

export const handleGithubWebhook = {
  async handlePostRequest (req, res) {
    const rb = req.body
    // console.log ("webhook", rb.action)

    if (rb.issue) {
      if (rb.action === "opened") {
        const issue: Issue = handleGithubWebhook.getIssue.fromOpenned (rb.issue)
        const user: User = handleGithubWebhook.getUser (rb.issue.user)
        const repository: Repository = handleGithubWebhook.getRepository (rb.repository)

        // make API call with this issue
        const responseBody = await youtrackRest ("get", "/user/current", {})
          .then ((response) => response.body)

        console.log ({responseBody})
      }
    }
    // respond with empty
    res.send ()
  },

  getUser: (rawUser: Object): User => ({
    username: rawUser.login,
    id: rawUser.id,
  }),

  getRepository: (rawRepository: Object): Repository => ({
    name: rawRepository.name,
    id: rawRepository.id,
  }),

  getIssue: {
    fromOpenned: (rawIssue: Object): Issue => ({
      id: rawIssue.id,
      title: rawIssue.title,
      body: rawIssue.body,
    }),
  },
}
