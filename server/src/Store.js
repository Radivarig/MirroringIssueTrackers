import {
  EntityService,
  EntityMapping,
} from "./types"

export class Mapping {
  mappings = []

  getEntityService (knownEntityService: EntityService, targetService: string) {
    for (let i = 0; i < this.mappings.length; ++i) {
      const mapping: EntityMapping = this.mappings[i]

      for (let j = 0; j < mapping.services.length; ++j) {
        const entityService: EntityService = mapping.services[j]

        // if we found known EntityService, return targetService
        if (entityService.service === knownEntityService.service &&
          entityService.id === knownEntityService.id)
          return mapping.services.filter ((f) => f.service === targetService)[0]
      }
    }
  }

/*
  remove (opts) {
    const knownKey: string = opts.knownKey
    const {knownValue} = opts

    // remove known mapping
    this.mappings = this.mappings.filter ((m) => m[knownKey] !== knownValue)
  }
*/

  add (newEntityService: EntityService, knownService: EntityService | void, assignToMapping: Object = {}) {
    for (let i = 0; i < this.mappings.length; ++i) {
      const mapping: EntityMapping = this.mappings[i]

      const alreadyExists = mapping.services.filter ((f) =>
        f.service === newEntityService.service && f.id === newEntityService.id
      )[0]

      if (alreadyExists) {
        Object.assign (mapping, assignToMapping)
        return
      }

      const knownMatch = knownService && mapping.services.filter ((f) =>
        f.service === knownService.service && f.id === knownService.id
      )[0]

      if (knownMatch) {
        // assign
        Object.assign (mapping, assignToMapping)
        // append service
        mapping.services.push (newEntityService)
        return
      }
    }
    // create new mapping
    const newEntityMapping: EntityMapping = {services: []}

    // fill services
    if (knownService)
      newEntityMapping.services.push (knownService)
    newEntityMapping.services.push (newEntityService)

    // assign
    Object.assign (newEntityMapping, assignToMapping)
    // create mapping
    this.mappings.push (newEntityMapping)

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
