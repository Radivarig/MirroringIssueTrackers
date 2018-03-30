export type KnownUsernameService = "github" | "youtrack"

export type UsernameInfo = {
  github: string,
  youtrack: string,
}

export type KnownUsernameInfo = {
  username: string,
  service: KnownUsernameService,
}

export default class UsernameMapping {
  constructor (mappings: Array<Object> = []) {
    this.mappings = mappings
  }

  getUsername (knownInfo: KnownUsernameInfo, targetService: KnownUsernameService) {
    for (const m of this.mappings) {
      for (const service in m) {
        if (service === knownInfo.service &&
          m[service].toLowerCase () === knownInfo.username.toLowerCase ())
          return m[targetService]
      }
    }
  }

}
