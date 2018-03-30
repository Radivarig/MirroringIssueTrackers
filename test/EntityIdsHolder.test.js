import EntityIdsHolder from '../src/EntityIdsHolder.js'
import {expect} from 'chai'

import {
  EntityInfo,
} from '../src/types'

let entityIdsHolder

beforeEach (()=> {
  entityIdsHolder = new EntityIdsHolder ()
})

describe('EntityIdsHolder', () => {
  const issue1: EntityInfo = {id: "1", service: "a"}
  const issue2: EntityInfo = {id: "2", service: "a"}

  describe('constructor', () => {
    it ('should clone from a passed instance', () => {
      entityIdsHolder.add (issue1)
      const newHolder = new EntityIdsHolder (entityIdsHolder)
      expect (newHolder.length).to.equal(1)
    })
  })

  describe('reset', () => {
    it ('should clear all', () => {
      entityIdsHolder.add (issue1)
      expect (entityIdsHolder.length).to.equal (1)
      expect (entityIdsHolder.contains (issue1)).to.equal (true)
      entityIdsHolder.reset ()
      expect (entityIdsHolder.length).to.equal (0)
      expect (entityIdsHolder.contains (issue1)).to.equal (false)
    })
  })

  describe('list', () => {
    it ('should return array of all entities', () => {
      entityIdsHolder.add (issue1)
      entityIdsHolder.add (issue2)
      expect (entityIdsHolder.list.length).to.equal (2)
      expect (entityIdsHolder.list).to.contain (issue1)
      expect (entityIdsHolder.list).to.contain (issue2)
    })
  })

  describe('get', () => {
    it ('should return saved entity for given entityInfo', () => {
      const issueWithExtra = {...issue1, extra: 123}
      entityIdsHolder.add (issueWithExtra)
      expect (entityIdsHolder.get (issue1)).to.contain (issueWithExtra)
    })
  })

  describe('length', () => {
    it ('returns number of entity ids', () => {
      expect (entityIdsHolder.length).to.equal (0)
      entityIdsHolder.add (issue1)
      expect (entityIdsHolder.length).to.equal (1)
      entityIdsHolder.add (issue2)
      expect (entityIdsHolder.length).to.equal (2)
      entityIdsHolder.remove (issue2)
      expect (entityIdsHolder.length).to.equal (1)
    })
  })

  describe('add', () => {
    it ('stores entity id', () => {
      expect (entityIdsHolder.contains (issue1)).to.equal (false)
      entityIdsHolder.add (issue1)
      expect (entityIdsHolder.contains (issue1)).to.equal (true)
    })

    it ('stores single entity id for multiple adds', () => {
      expect (entityIdsHolder.contains (issue1)).to.equal (false)
      entityIdsHolder.add (issue1)
      expect (entityIdsHolder.length).to.equal (1)
      entityIdsHolder.add (issue1)
      expect (entityIdsHolder.length).to.equal (1)
    })
  })
  
  describe('remove', () => {
    it ('removes entity id', () => {
      expect (entityIdsHolder.contains (issue1)).to.equal (false)
      entityIdsHolder.add (issue1)
      expect (entityIdsHolder.contains (issue1)).to.equal (true)
      expect (entityIdsHolder.length).to.equal (1)
      entityIdsHolder.remove (issue1)
      expect (entityIdsHolder.contains (issue1)).to.equal (false)
      expect (entityIdsHolder.length).to.equal (0)
    })
  })

  describe('contains', () => {
    it ('returns boolean for is entity id stored', () => {
      expect (entityIdsHolder.contains (issue1)).to.equal (false)
      entityIdsHolder.add (issue1)
      expect (entityIdsHolder.contains (issue1)).to.equal (true)
    })
  })
})
