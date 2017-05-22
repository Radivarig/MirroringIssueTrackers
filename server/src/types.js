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
  issueService: string | void;
  issueId: string | void;
}
export type EntityMapping = {
  flag: string | void;
  originalService: string | void;
  services: Array<EntityService>;
}
