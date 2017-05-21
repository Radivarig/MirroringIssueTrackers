export class Mapping {
  mappings = []

  getValueByKeyAndKnownKeyValue (opts) {
    const key: string = opts.key
    const knownKey: string = opts.knownKey
    const {knownValue} = opts

    const match = this.mappings.filter ((f) => f[knownKey] === knownValue)[0]
    return match && match[key]
  }

  remove (opts) {
    const knownKey: string = opts.knownKey
    const {knownValue} = opts

    // remove known mapping
    this.mappings = this.mappings.filter ((m) => m[knownKey] !== knownValue)
  }

  add (opts) {
    const knownKey: string | void = opts.knownKey
    const newKey: string = opts.newKey
    const {knownValue, newValue} = opts

    // iterate array
    for (const mapping of this.mappings) {
      // iterate keys
      for (const key in mapping) {
        // if known key-value match
        if (knownKey && key === knownKey && mapping[knownKey] === knownValue) {
          mapping[newKey] = newValue
          return
        }

        // return if new key already exists
        if (key === newKey && mapping[newKey] === newValue)
          return

      }
    }
    // adding first time
    const mapping = {}
    if (knownKey)
      mapping[knownKey] = knownValue
    mapping[newKey] = newValue
    this.mappings.push (mapping)
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

export default {
  issueMappings: new Mapping (),
  commentMappings: new Mapping (),
}
