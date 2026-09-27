import assert from 'node:assert/strict'
import test from 'node:test'
import { selectReactPublishVersion } from '../scripts/prepare-react-publish.js'

test('branch publication increments the React version when a push did not change it', () => {
  assert.equal(selectReactPublishVersion('0.10.1-react.9', '0.10.1-react.9'), '0.10.1-react.10')
})

test('branch publication respects an already-increased React version', () => {
  assert.equal(selectReactPublishVersion('0.10.1-react.10', '0.10.1-react.9'), '0.10.1-react.10')
  assert.equal(selectReactPublishVersion('0.10.2-react.1', '0.10.1-react.9'), '0.10.2-react.1')
})

test('branch publication rejects version rollback and invalid metadata', () => {
  assert.throws(() => selectReactPublishVersion('0.10.1-react.9', '0.10.1-react.10'), /must increase/)
  assert.throws(() => selectReactPublishVersion('0.10.1', '0.10.1-react.9'), /React preview/)
})

test('first branch publication can keep its chosen version', () => {
  assert.equal(selectReactPublishVersion('0.10.1-react.9', null), '0.10.1-react.9')
})
