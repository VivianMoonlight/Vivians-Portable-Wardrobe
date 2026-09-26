import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWardrobeLoginCapture } from '../src/utils/wardrobe-login-capture.js'

const player = { MemberNumber: 42 }
const response = { memberNumber: 42, extensionSettings: { VPWardrobe: 'fresh cloud' } }

test('normal initial login is accepted when request and response occur under one writer lock', () => {
  const capture = createWardrobeLoginCapture()
  capture.markRequest(3)
  capture.noteResponse()
  capture.record(response, player, 3)
  assert.equal(capture.take({ member: '42', player, lockToken: 3 }), response)
})

test('waiting tab discards a response to a request made before lock ownership', () => {
  const capture = createWardrobeLoginCapture()
  capture.markRequest(null)
  capture.noteResponse()
  capture.record(response, player, null)
  assert.equal(capture.take({ member: '42', player, lockToken: 4 }), null)
})

test('a pre-lock request with a post-lock response is still stale', () => {
  const capture = createWardrobeLoginCapture()
  capture.markRequest(null)
  capture.noteResponse()
  capture.record(response, player, 4)
  assert.equal(capture.take({ member: '42', player, lockToken: 4 }), null)
})

test('response from a prior lock generation, another account, or replaced Player is discarded', () => {
  const capture = createWardrobeLoginCapture()
  capture.markRequest(2)
  capture.noteResponse()
  capture.record(response, player, 2)
  assert.equal(capture.take({ member: '42', player, lockToken: 4 }), null)
  capture.markRequest(4)
  capture.noteResponse()
  capture.record(response, player, 4)
  assert.equal(capture.take({ member: '43', player, lockToken: 4 }), null)
  capture.markRequest(4)
  capture.noteResponse()
  capture.record(response, player, 4)
  assert.equal(capture.take({ member: '42', player: { MemberNumber: 42 }, lockToken: 4 }), null)
})

test('ambiguous overlapping requests cannot certify a response', () => {
  const capture = createWardrobeLoginCapture()
  capture.markRequest(null)
  capture.markRequest(4)
  capture.noteResponse()
  capture.record(response, player, 4)
  assert.equal(capture.take({ member: '42', player, lockToken: 4 }), null)
})
