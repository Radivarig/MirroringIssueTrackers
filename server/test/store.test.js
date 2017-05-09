import chai, {expect} from 'chai'

import Store, {Mapping} from "../src/Store"

describe('Mappings store', () => {
  it('should have correct initialState', () => {
    throw "not implemented"
  })

  const store = new Store ()
  it('should have issueMappings', () => {
    const mapping: Mapping = store.issueMappings
  })
  it('should have commentMappings', () => {
    const mapping: Mapping = store.commentMappings
  })
})

describe('Mapping', () => {
  const key1 = Math.random ().toString ()
  const value1 = Math.random ()

  const key2 = Math.random ().toString ()
  const value2 = Math.random ()

  describe('add', () => {
    it('should add new key-value', () => {
      const mapping: Mapping = new Mapping ()

      mapping.add ({newKey: key1, newValue: value1})
      expect (mapping.mappings.length).to.equal (1)
      expect (mapping.mappings[0][key1]).to.equal (value1)
    })

    it('should extend new key-value to existing key-value', () => {
      const mapping: Mapping = new Mapping ()

      mapping.add ({newKey: key1, newValue: value1})
      mapping.add ({
        knownKey: key1, knownValue: value1,
        newKey: key2, newValue: value2,
      })
      expect (mapping.mappings[0][key1]).to.equal (value1)
      expect (mapping.mappings[0][key2]).to.equal (value2)
    })

  })

  describe('getValueByKeyAndKnownKeyValue', () => {
    const mapping: Mapping = new Mapping ()
    mapping.add ({newKey: key1, newValue: value1})
    mapping.add ({
      knownKey: key1, knownValue: value1,
      newKey: key2, newValue: value2,
    })
    it('should return a value, given the counterpart key and another key-value', () => {
      expect (
        mapping.getValueByKeyAndKnownKeyValue ({
          key: key1,
          knownKey: key2,
          knownValue: value2,
        })
      ).to.equal (value1)
    })

    it('should return undefined if counterpart key does not exist', () => {
      expect (
        mapping.getValueByKeyAndKnownKeyValue ({
          key: Math.random ().toString (),
          knownKey: key2,
          knownValue: value2,
        })
      ).to.equal (undefined)
    })
  })
})
