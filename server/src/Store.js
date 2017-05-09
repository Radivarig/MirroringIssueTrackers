import mobx, {observable, computed} from 'mobx'

export class Mapping {
  constructor () {
    // mobx.autorun(() => console.log(this.report))
  }

  @observable pendingRequests = 0

  @observable mappings = []

  getValueByKeyAndKnownKeyValue (opts) {
    const key: string = opts.key
    const knownKey: string = opts.knownKey
    const {knownValue} = opts

    const match = this.mappings.filter ((f) => f[knownKey] === knownValue)[0]
    return match && match[key]
  }

  add (opts) {
    const knownKey: string | void = opts.knownKey
    const newKey: string = opts.newKey
    const {knownValue, newValue} = opts

    // adding first time
    if (knownKey === undefined) {
      const mapping = {}
      mapping[newKey] = newValue
      this.mappings.push (mapping)
    }
    // adding new mapping to existing key-value
    else {
      // iterate array
      for (const mapping of this.mappings) {
        // iterate keys
        for (const key in mapping) {
          // if known key-value match
          if (key === knownKey && mapping[knownKey] === knownValue)
            mapping[newKey] = newValue
        }
      }
    }
  }

}
/*
  @computed get report () {
    if (this.todos.length === 0)
      return "<none>"
    return `Next todo: "${this.todos[0].task}". ` +
      `Progress: ${this.completedTodosCount}/${this.todos.length}`
  }
*/

export default class Store {
  issueMappings: Mapping = new Mapping ()
  commentMappings: Mapping = new Mapping ()
}
