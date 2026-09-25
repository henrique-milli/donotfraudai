/* Triage console mock markup, shared by slides.html and pitch-clips.
   index.html carries its own static copy. */
export const consoleHTML = u => `<div class="console">
          <div class="chrome"><i></i><i></i><i></i><div class="url">localhost:3000/triage?tab=high&amp;case=11007</div></div>
          <div class="app">
            <aside class="c-side">
              <div class="b"><i></i>Attest</div>
              <a class="on" href="#triage">Triage <u>7</u></a>
              <a href="#triage">Faces</a>
              <a href="#triage">Audit trail</a>
              <a href="#triage">Lab</a>
            </aside>
            <div class="c-queue" data-hot="queue">
              <h5>Fraud triage queue (7)</h5>
              <div class="search">Search name, document, case or session…</div>
              <div class="c-tabs"><span>All</span><span class="on">High</span><span>Medium</span><span>Low</span></div>
              <div class="c-row on"><div class="t">#11007 <span class="rp h">High</span></div><div class="m">just now · open · Pixel 6 · real session</div></div>
              <div class="c-row"><div class="t">#11002 <span class="rp h">High</span></div><div class="m">demo · Screen replay of an ID · Lukas Beispiel</div></div>
              <div class="c-row"><div class="t">#11004 <span class="rp h">High</span></div><div class="m">demo · Emulator, injected camera · Marc Exemple</div></div>
              <div class="c-row"><div class="t">#11006 <span class="rp h">High</span></div><div class="m">demo · Printed B/W copy · Tom Modell</div></div>
              <div class="c-row"><div class="t">#11003 <span class="rp m">Medium</span></div><div class="m">demo · Chip downgrade attempt · Sofia Esempio</div></div>
              <div class="c-row"><div class="t">#11005 <span class="rp m">Medium</span></div><div class="m">demo · Rooted phone, legacy card · Nina Prova</div></div>
              <div class="c-row"><div class="t">#11001 <span class="rp l">Low</span></div><div class="m">demo · Clean chip read · Anna Muster</div></div>
            </div>
            <main class="c-main">
              <div class="c-card"><div class="c-head"><h4>Case #11007</h4><span class="rp h">High risk</span><span style="margin-left:auto;color:#6b7280">Swiss residence permit · session 160970CC</span></div></div>
              <div class="c-grid2">
                <div class="c-card" data-hot="score"><h6>Fraud risk assessment</h6>
                  <div class="c-gauge">
                    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#eef0f4" stroke-width="10"/><circle cx="50" cy="50" r="40" fill="none" stroke="#dc2f25" stroke-width="10" stroke-dasharray="251 251" transform="rotate(-90 50 50)"/><text x="50" y="56" text-anchor="middle" font-size="24" font-weight="800" fill="#111827">100</text></svg>
                    <div><b style="font-size:14px">Route · BRANCH_VISIT</b><br /><span style="color:#6b7280">80 signals · 52 passed · 6 fired</span><br /><span style="color:#6b7280">phone's own score: advisory</span></div>
                  </div>
                </div>
                <div class="c-card" data-hot="face"><h6>Face verification · YuNet · SFace · MiniFASNet</h6>
                  <div class="c-face">
                    <div class="ph" style="background-image:url(${u('img/face.jpg')});background-position:50% 30%;background-size:180%"></div>
                    <div class="ph blur" style="background:#cbd2dc"></div>
                    <div><b style="color:#dc2f25">No match</b> · similarity below 36%<br /><span style="color:#6b7280">Passive liveness ✓ · 1:N cluster F-00001</span></div>
                  </div>
                </div>
              </div>
              <div class="c-card" data-hot="ladder"><h6>Confidence path</h6>
                <div class="c-steps">
                  <div class="f"><b>Device</b>root hidden · boot spoofed</div>
                  <div class="p"><b>Document</b>PAD 7/7 · MRZ ✓</div>
                  <div class="p"><b>Chip</b>ICAO 9303 · signature ✓</div>
                  <div class="f"><b>Face</b>1:1 vs DG2 · no match</div>
                </div>
              </div>
              <div class="c-card" data-hot="signals"><h6>Raw signals</h6>
                <div class="c-sig">
                  <div><span>Presentation attack</span><span style="color:#0f9960">7/7 passed</span></div>
                  <div><span>Face verification</span><span style="color:#dc2f25">1 fired</span></div>
                  <div><span>Chip · ICAO 9303</span><span style="color:#0f9960">7/7 passed</span></div>
                  <div><span>Device integrity</span><span style="color:#dc2f25">10/15 · +cap 50</span></div>
                  <div><span>Cross-checks</span><span style="color:#c27400">document expired</span></div>
                  <div><span>Image quality</span><span style="color:#0f9960">15/15 passed</span></div>
                </div>
              </div>
            </main>
            <aside class="c-right">
              <div class="c-card" data-hot="rec"><h6>✦ Assessment summary</h6>
                <div class="c-rec"><b>Invite to branch</b><br /><span style="color:#4b5563">Hidden root, a face that doesn't match the chip photo, and an expired document.</span></div>
                <div class="c-why" style="margin-top:8px"><div><b>Not approving because</b><br />device can't be trusted · face ≠ DG2</div><div><b>Not rejecting because</b><br />chip genuine · PAD clean · appealable</div></div>
              </div>
              <div class="c-card" data-hot="decide"><h6>Analyst decision</h6>
                <div class="search" style="height:40px;margin-bottom:8px;align-items:flex-start;padding-top:6px">Note for the audit trail…</div>
                <div class="c-btns"><span class="ap">✓ Approve</span><span>↻ Request verification</span><span>⚠ Escalate</span><span class="rj">✕ Reject</span></div>
              </div>
              <div class="c-card" data-hot="audit"><h6>Audit trail · hash-chained</h6>
                <div class="c-audit"><div><span>✓ chain intact</span> · 14 events verified</div><div>#14 decision · 9f2c…e1a0</div><div>#13 scored · 41b7…c2d9</div><div>#12 ingested · 0a93…77f4</div></div>
              </div>
            </aside>
          </div>
        </div>
      </div>`;
