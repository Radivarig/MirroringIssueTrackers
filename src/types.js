export type AuthConfig = {
  youtrack: {
    url: string,
    token: string,
    project: string,
  },
  github: {
    url: string,
    token: string,
    user: string,
    project: string,
  },
}

export type IssueInfo = {
  service: string,
  id: string,
}

export type IssueCommentInfo = {
  ...IssueInfo,
  // comment parent
  issueId: string,
}

export type EntityInfo = IssueInfo | IssueCommentInfo

// for deprecation
export type EntityService = EntityInfo

export type Issue = {
  ...IssueInfo,
  title: string,
  body: string,
}

export type IssueComment = {
  ...IssueCommentInfo,
  body: string,
}

export type Entity = Issue | IssueComment

export type EntityMapping = {
  flag: string | void,
  originalService: string | void,
  services: Array<EntityService>,
}

export type Service = "github" | "youtrack"

export type DoSingleEntityAction =
  "created" |
  "updated" |
  "deleted" |
  "skipped_mirror" |
  "skipped_equal"
