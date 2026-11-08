# Assistant delivery recovery

All popup hosts (Studio, Image Studio, Vidgenie, Express, Ad Creator and Audio Studio) use
`useAssistantRequestGuard` for submission and delivery. Assistant delivery owns
its timers independently of media-generation polling.

- `beginRequest()` invalidates the previous conversation request's callbacks.
- `submit()` bounds each acknowledgement wait to 15 seconds. It retries an
  uncertain submission once with the **same payload and client request ID**.
  Further recovery is exposed through the popup's Retry action. Never create a
  new request ID when retrying a submission whose outcome is unknown.
- `watch()` starts SSE and an immediate authenticated status read. REST reads
  take at most 10 seconds, with one read in flight and a one-second delay between
  reads. SSE connections are released on terminal events and bounded to 45 seconds
  even when a proxy leaves the body open. Normal server rotations reconnect.
- Restoring network connectivity or returning to the tab reconnects active
  delivery. After 60 seconds without an accepted status snapshot, the popup
  stops spinning and offers Retry. This only reloads the existing response.
- Healthy pending snapshots can contain no text while a model reasons. Twelve
  minutes without progress offers recovery without cancelling provider work or
  changing the server's pending/billing state.
- Session/version/query identity and sequence checks discard stale responses.
  Clearing, navigation and unmount abort outstanding transports and retries.
  Completion releases both delivery transports. Server errors preserve partial
  text and are displayed in the popup.

The existing streaming and REST endpoints and billing contracts are unchanged.
The client must be built and deployed for these changes to affect a running site.

Regression checks live in `test/unit/AssistantDelivery.test.jsx`, the shared
assistant popup tests and the Image Studio/Vidgenie integration tests.
