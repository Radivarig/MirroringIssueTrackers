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
