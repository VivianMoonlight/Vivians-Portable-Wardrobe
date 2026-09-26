/** Match a BC login response to a request made under the current writer lock. */
export function createWardrobeLoginCapture() {
  let requests = []
  let completedRequestToken = null
  let latest = null

  return {
    markRequest(lockToken) {
      requests.push(lockToken)
      completedRequestToken = null
    },
    noteResponse() {
      completedRequestToken = requests.length === 1 ? requests[0] : null
      requests = []
    },
    record(event, player, lockToken) {
      latest = {
        event, player, member: String(event.memberNumber),
        requestToken: completedRequestToken, responseToken: lockToken,
      }
      completedRequestToken = null
    },
    clear() {
      requests = []
      completedRequestToken = null
      latest = null
    },
    take({ member, player, lockToken }) {
      const captured = latest
      latest = null
      if (!captured || captured.member !== String(member) || captured.player !== player) return null
      return captured.requestToken !== null && captured.requestToken === lockToken
        && captured.responseToken === lockToken ? captured.event : null
    },
  }
}
