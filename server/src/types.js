export type AuthConfig = {
  youtrack: {
    url: string;
    token: string;
    project: string;
  };
  github: {
    url: string;
    token: string;
    user: string;
    project: string;
  };
}

// todo: add url
export type Issue = {
  id: string;
  title: string;
  body: string;
  service: string;
}
export type IssueComment = {
  id: string;
  body: string;
  service: string;
  issueId: string;
}
export type Entity = Issue | IssueComment

export type EntityService = {
  service: string,
  id: string,
  // this is for comment parent
  issueId: string | void;
}
export type EntityMapping = {
  flag: string | void;
  originalService: string | void;
  services: Array<EntityService>;
}
export type DoSingleEntityAction =
  "created" |
  "updated" |
  "deleted" |
  "skipped_mirror" |
  "skipped_equal"
