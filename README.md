# Mirroring Issue Trackers

Server that syncs issues from [Youtrack](https://www.jetbrains.com/youtrack/) issue tracker with [Github](https://github.com/) issues.

## Features

- Syncs create/edit/delete of issues and their comments
- Maps Github open/close issue state with Youtrack State field
- Shows Youtrack fields as Github labels in format `FieldName:FieldValue`
- Shows Youtrack tags as Github labels in format `Tag:TagName`
- Skips sync for issues marked with specified tags or by containing sensitive strings
- Forces sync for issues with tag `forcemirror`
- Shows Youtrack hierarchy as `Parents for` `Subtask of` counterpart issues list
- Username mapping
- Live mode listening for changes

## Todo
- Mirror Github labels as Youtrack tags
- Sync Github label changes from mirrors to originals (excluding title/body)

## Caveats

- Github issues cannot be deleted so all comments are removed, body is set to blank and title is set to `(Issue Removed)`
- Youtrack has no API method for detecting deleted issues. If you restart the server it will detect this and delete the counterpart.
- Do not change Youtrack project ID or you'll create duplicate issues.

Double check that you've entered correct project information.

## Usage

(*All of the following is required in order for server to work properly*)

- Create bot account on both services that will author the mirrored content (e.g. YourCompany-bot)

- Enable experimantal JS Workflow Editor
  - Open Settings > Gobal Settings > Open Feature Configuration page and set "New Workflow Editor" to a user group "All Users" or other more restrictive group.

- Increase "Max Issues To Export" to way more than you have issues in a project, like 10000.
  - Open Settings > Gobal Settings > Max Issues To Export

- Youtrack Workflow webhook:
  - Compress `github_mirroring_webhooks` [folder](https://github.com/Radivarig/MirroringIssueTrackers/tree/master/server/workflows/github_mirroring_webhooks) to `github_mirroring_webhooks.zip`
  - Project > select your project > Edit Project > Workflow > Import Workflow and select github_mirroring_webhooks.zip
  - Edit the file named config of the webhook to your server URL + `:7777/youtrack_webhook`

- Github webbhook:
  - Repository > Settings > Webhooks > Add webhook
  - Set "Payload URL" to your server URL + `:7777/github_webhook`
  - Set "Content type" to "application/json"
  - Select in "Let me select individual events": "Issues", "Issue comment", "Label", and deselect "Push"

- Youtrack token:
  - Settings -> Users -> (select bot user) -> Authentication > New token (Scope: YouTrack)

- Github token:
  - Settings -> Personal access tokens -> Generate new token (Scope: repo)

- Export an object of AuthConfig type in `./config/auth.config.js`

```js
export default {
  youtrack: {
    url: "SERVER_URL:PORT/rest",
    token: "BOT_ACCOUNT_TOKEN",
    project: "PROJECT_ID",
  },
  github: {
    url: "api.github.com",
    token: "BOT_ACCOUNT_TOKEN",
    user: "REPOSITORY_OWNER",
    project: "REPOSITORY_NAME",
  },
}
```
Export an object of SettingsConfig type in `./config/settings.config.js`
```js
export default {
  fieldsToIncludeAsLabels: [
    "Priority",
    "State",
    "Type",
  ],

  closedFieldStateValues: [ // case sensitive
    "Can't Reproduce",
    "Duplicate",
    "Fixed",
    "Won't fix",
    "Incomplete",
    "Obsolete",
    "Verified",
  ],

  mirroringBlacklistTags: [ // lowercase
    "topsecret",
  ],

  sensitiveStrings: [ // case isensitive
    "password",
    "auth",
    "security",
  ],
}
```

# Installation

Should work with npm `4.2.0`, nodejs `7.10.0`
```bash
$ git clone github.com/Radivarig/MirroringIssueTrackers
$ cd MirroringIssueTrackers/server
$ npm i
$ npm run build
$ npm run start # don't forget to add configs
```

## Tests

`.config/auth.config.js` should look like this
```js
const auth: {
  production : AuthConfig,
  test: AuthConfig,
} = {...}

export default auths[process.env.ENV]
```
Test user should be different than production and should have special project/repository just for testing.  

Then run `npm run test`

## License

MIT
