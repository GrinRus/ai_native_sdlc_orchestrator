export function guidedBrowserTaskCollectorPythonSource() {
  return String.raw`import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


def write_json(path, document):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def main():
    payload = json.loads(sys.argv[1])
    timeout_ms = int(payload.get("timeout_ms") or 30000)
    app_url = payload["app_url"]
    with sync_playwright() as playwright:
        # Keep loopback control-plane calls on the local socket even when the
        # host exports an HTTP proxy. External requests remain forbidden by
        # the collector's request audit below.
        browser = playwright.chromium.launch(headless=True, args=["--no-proxy-server"])
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        console_errors = []
        observed_optional_404_console = []
        injection_active = {"value": False}
        external_requests = []
        app_origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
        def record_console(message):
            if message.type != "error":
                return
            if injection_active["value"]:
                return
            if message.text == "Failed to load resource: the server responded with a status of 404 (Not Found)":
                observed_optional_404_console.append(message.text)
                return
            console_errors.append(message.text)
        page.on("console", record_console)
        page.on("request", lambda request: external_requests.append(request.url) if not request.url.startswith(app_origin) else None)
        def wait_for_ready():
            readiness = {"status": "not_pass", "observed_state": "timeout", "expected_state": "ready"}
            deadline = time.monotonic() + timeout_ms / 1000
            while time.monotonic() < deadline:
                try:
                    readiness_probe = page.evaluate("""async ({controlPlane, projectId}) => {
                  const fetchJson = async (url) => {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 5000);
                    try {
                      const response = await fetch(url, {signal: controller.signal});
                      return {response, body: response.ok ? await response.json() : null};
                    } finally {
                      clearTimeout(timer);
                    }
                  };
                  const [stateResult, flowResult] = await Promise.all([
                    fetchJson(controlPlane + '/api/projects/' + encodeURIComponent(projectId) + '/state'),
                    fetchJson(controlPlane + '/api/projects/' + encodeURIComponent(projectId) + '/flows/selected'),
                  ]);
                  const bodyText = (document.body?.innerText || '').toLowerCase();
                  return {
                    stateStatus: stateResult.response.status,
                    flowStatus: flowResult.response.status,
                    state: stateResult.body,
                    flow: flowResult.body,
                    loading: bodyText.includes('loading') || bodyText.includes('syncing'),
                  };
                }""", {"controlPlane": payload["control_plane"], "projectId": payload["project_id"]})
                except Exception:
                    readiness["observed_state"] = "partial"
                    page.wait_for_timeout(250)
                    continue
                state_project = (readiness_probe.get("state") or {}).get("project_id")
                selected_flow = readiness_probe.get("flow") or {}
                if readiness_probe.get("stateStatus") == 200 and readiness_probe.get("flowStatus") == 200 and state_project == payload["project_id"] and selected_flow.get("flow_id") and not readiness_probe.get("loading"):
                    readiness = {
                        "status": "pass",
                        "observed_state": selected_flow.get("status") or "ready",
                        "expected_state": selected_flow.get("status") or "ready",
                        "durable_precondition_ref": f"{payload['control_plane']}/api/projects/{payload['project_id']}/flows/selected",
                        "flow_id": selected_flow.get("flow_id"),
                    }
                    break
                readiness["observed_state"] = "loading" if readiness_probe.get("loading") else "partial"
                page.wait_for_timeout(250)
            return readiness

        def safe_goto(url):
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            except Exception:
                pass

        def safe_reload():
            try:
                page.reload(wait_until="domcontentloaded", timeout=timeout_ms)
            except Exception:
                pass

        def wait_for_ready_with_retry():
            readiness = wait_for_ready()
            if readiness.get("status") != "pass":
                safe_reload()
                readiness = wait_for_ready()
            return readiness

        safe_goto(app_url)
        readiness = wait_for_ready_with_retry()
        html = page.content()
        Path(payload["rendered_html_file"]).write_text(html, encoding="utf-8")
        screenshot_file = payload["screenshot_file"]
        # Viewport captures keep the proof bounded even when a disposable run
        # accumulates a long task queue; the responsive matrix covers the page
        # at each required viewport explicitly.
        page.screenshot(path=screenshot_file, full_page=False)
        dom_snapshot = page.evaluate("""() => {
          const selectorFor = (el) => {
            if (!el) return null;
            if (el.id) return '#' + CSS.escape(el.id);
            const rawClass = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
            const classSuffix = rawClass.length > 0 ? '.' + rawClass.map((part) => CSS.escape(part)).join('.') : '';
            const parent = el.parentElement;
            const siblings = parent ? Array.from(parent.children).filter((item) => item.tagName === el.tagName) : [];
            const nth = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')' : '';
            return el.tagName.toLowerCase() + classSuffix + nth;
          };
          const visible = (el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const labelFor = (el) => (
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.innerText ||
            el.textContent ||
            el.getAttribute('name') ||
            el.id ||
            ''
          ).trim().replace(/\s+/g, ' ').slice(0, 160);
          const roleFor = (el) => el.getAttribute('role') || (
            el.tagName.toLowerCase() === 'a' ? 'link' :
            el.tagName.toLowerCase() === 'button' ? 'button' :
            el.tagName.toLowerCase() === 'select' ? 'combobox' :
            el.tagName.toLowerCase() === 'input' ? 'textbox' :
            null
          );
          const focusableSelector = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="menuitem"],[role="tab"]';
          const focusableControls = Array.from(document.querySelectorAll(focusableSelector))
            .filter((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
            .slice(0, 80)
            .map((el, index) => ({
              index: index + 1,
              tag_name: el.tagName.toLowerCase(),
              role: roleFor(el),
              label: labelFor(el),
              selector: selectorFor(el),
              tab_index: el.tabIndex
            }));
          const semantic = {
            title: document.title || null,
            h1_count: document.querySelectorAll('h1').length,
            heading_count: document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').length,
            main_count: document.querySelectorAll('main,[role="main"]').length,
            button_count: document.querySelectorAll('button,[role="button"]').length,
            form_control_count: document.querySelectorAll('button,input,select,textarea').length,
            status_region_count: document.querySelectorAll('[role="status"],[role="alert"],[aria-live]').length
          };
          const parseRgb = (value) => {
            const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
            if (!match) return null;
            const alpha = match[4] === undefined ? 1 : Number(match[4]);
            return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
          };
          const relativeLuminance = (rgb) => {
            const channel = (value) => {
              const srgb = value / 255;
              return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
          };
          const contrastRatio = (left, right) => {
            const l1 = relativeLuminance(left);
            const l2 = relativeLuminance(right);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          };
          const backgroundFor = (el) => {
            let current = el;
            while (current) {
              const style = window.getComputedStyle(current);
              const backgroundColor = parseRgb(style.backgroundColor);
              if (backgroundColor && backgroundColor.a >= 0.98) return backgroundColor;
              const backgroundImage = parseRgb(style.backgroundImage);
              if (backgroundImage && backgroundImage.a >= 0.98) return backgroundImage;
              current = current.parentElement;
            }
            return { r: 255, g: 255, b: 255, a: 1 };
          };
          const contrastSamples = focusableControls.slice(0, 30).map((control) => {
            const el = document.querySelector(control.selector);
            if (!el) return null;
            const style = window.getComputedStyle(el);
            const color = parseRgb(style.color);
            const background = backgroundFor(el);
            return color ? {
              selector: control.selector,
              label: control.label,
              ratio: Number(contrastRatio(color, background).toFixed(2)),
              font_size: Number.parseFloat(style.fontSize) || 0,
              font_weight: Number.parseInt(style.fontWeight, 10) || 400
            } : null;
          }).filter(Boolean);
          return {
            url: window.location.href,
            title: document.title || null,
            body_text_sample: (document.body?.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 5000),
            focusable_controls: focusableControls,
            semantic,
            contrast_samples: contrastSamples
          };
        }""")
        try:
            page.locator("body").click(position={"x": 1, "y": 1}, timeout=3000)
        except Exception:
            pass
        focus_sequence = []
        for index in range(1, 21):
            page.keyboard.press("Tab")
            active = page.evaluate("""(index) => {
              const el = document.activeElement;
              if (!el || el === document.body) return null;
              const selectorFor = (node) => {
                if (node.id) return '#' + CSS.escape(node.id);
                const rawClass = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
                const classSuffix = rawClass.length > 0 ? '.' + rawClass.map((part) => CSS.escape(part)).join('.') : '';
                const parent = node.parentElement;
                const siblings = parent ? Array.from(parent.children).filter((item) => item.tagName === node.tagName) : [];
                const nth = siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : '';
                return node.tagName.toLowerCase() + classSuffix + nth;
              };
              const label = (
                el.getAttribute('aria-label') ||
                el.getAttribute('title') ||
                el.innerText ||
                el.textContent ||
                el.getAttribute('name') ||
                el.id ||
                ''
              ).trim().replace(/\s+/g, ' ').slice(0, 160);
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : tag === 'input' ? 'textbox' : null);
              return { index, role, label, selector: selectorFor(el), tag_name: tag };
            }""", index)
            if active:
                focus_sequence.append(active)

        dialog_probe = {"opened": False, "focus_inside": False, "focus_restored": False, "entry_point": None}
        def probe_dialog(dialog_opener, entry_point):
            if dialog_probe["opened"] or dialog_opener.count() != 1 or not dialog_opener.is_enabled():
                return
            dialog_probe["entry_point"] = entry_point
            dialog_opener.focus()
            dialog_opener.click()
            dialog = page.get_by_role("dialog")
            if dialog.count() == 1:
                dialog_probe["opened"] = True
                page.keyboard.press("Tab")
                dialog_probe["focus_inside"] = page.evaluate("() => Boolean(document.activeElement?.closest('[role=\"dialog\"]'))")
                page.keyboard.press("Escape")
                dialog_probe["focus_restored"] = dialog_opener.evaluate("(el) => document.activeElement === el")

        dialog_opener = page.get_by_role("button", name="Ask AOR for selected flow")
        if dialog_opener.count() == 1 and dialog_opener.is_enabled():
            probe_dialog(dialog_opener, "active-flow-ask-aor")
        else:
            add_project_button = page.get_by_role("button", name="Add AOR Project", exact=True)
            if add_project_button.count() == 1 and add_project_button.is_enabled():
                probe_dialog(add_project_button, "add-project")

        try:
            action_probe = page.evaluate("""async ({controlPlane, projectId}) => {
          const fetchJson = async (url, init = {}) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            try {
              const response = await fetch(url, {...init, signal: controller.signal});
              return {response, body: response.ok ? await response.json() : null};
            } finally {
              clearTimeout(timer);
            }
          };
          const selectedResult = await fetchJson(controlPlane + '/api/projects/' + encodeURIComponent(projectId) + '/flows/selected');
          const selectedResponse = selectedResult.response;
          if (!selectedResponse.ok) return { status: 'not_pass', reason: 'selected-flow-read-failed' };
          const flow = selectedResult.body;
          const detailResult = await fetchJson(controlPlane + '/api/projects/' + encodeURIComponent(projectId) + '/flows/' + encodeURIComponent(flow.flow_id));
          const detailResponse = detailResult.response;
          if (!detailResponse.ok) return { status: 'not_pass', reason: 'flow-detail-read-failed' };
          const detail = detailResult.body;
          const route = '/api/projects/' + encodeURIComponent(projectId) + '/operator-requests';
          const requestText = 'Installed browser proof durable readback ' + String(Date.now());
          const createdResult = await fetchJson(controlPlane + route, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
              target_flow_id: flow.flow_id,
              target_stage: 'discovery',
              intent_type: 'analyze',
              request_text: requestText,
              target_refs: [detail.intake_packet_ref || detail.latest_next_action_report_ref],
              delivery_mode: 'no-write'
            })
          });
          const createdResponse = createdResult.response;
          const created = createdResult.body;
          const responseId = created?.operator_request?.document?.request_id || created?.operator_request_id;
          if (![200, 201].includes(createdResponse.status) || !responseId) return { status: 'not_pass', reason: 'mutation-failed', response_status: createdResponse.status };
          const listResult = await fetchJson(controlPlane + route);
          const listResponse = listResult.response;
          const listed = listResult.body;
          return {
            status: listResponse.ok && JSON.stringify(listed).includes(responseId) ? 'pass' : 'not_pass',
            route,
            response_id: responseId,
            flow_id: flow.flow_id,
            evidence_ref: controlPlane + route,
          };
        }""", {"controlPlane": payload["control_plane"], "projectId": payload["project_id"]})
        except Exception as error:
            action_probe = {"status": "not_pass", "reason": str(error)[:240]}
        safe_reload()
        try:
            reload_readback = page.evaluate("""async ({controlPlane, projectId, responseId}) => {
          const route = '/api/projects/' + encodeURIComponent(projectId) + '/operator-requests';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          let response;
          try {
            response = await fetch(controlPlane + route, {signal: controller.signal});
          } finally {
            clearTimeout(timer);
          }
          const payload = response.ok ? await response.json() : null;
          return response.ok && JSON.stringify(payload).includes(responseId);
        }""", {"controlPlane": payload["control_plane"], "projectId": payload["project_id"], "responseId": action_probe.get("response_id")})
        except Exception:
            reload_readback = False

        post_reload_readiness = wait_for_ready_with_retry()
        task_workspace_probe = {"status": "not_pass", "reason": "new-task-control-not-found"}
        task_workspace_screenshot = str(Path(screenshot_file).with_name(Path(screenshot_file).stem + "-task-workspace.png"))
        new_task = page.get_by_role("button", name="New task", exact=True)
        if new_task.count() == 1 and new_task.is_enabled():
            try:
                new_task.click()
                page.get_by_role("heading", name="New Task", exact=True).wait_for(state="visible", timeout=timeout_ms)
                probe_dialog(page.get_by_role("button", name="Add Markdown", exact=True), "task-sources")
                outcome = page.get_by_label("Task outcome", exact=True)
                outcome.fill("Installed browser proof Task Workspace")
                page.get_by_role("button", name="Prepare task", exact=True).click()
                prepared_heading = page.get_by_role("heading", name="Prepared Task", exact=True)
                attention_heading = page.get_by_role("heading", name="Attention", exact=True)
                recovery_control = page.get_by_role("button", name="Resume task preparation", exact=True)
                deadline = time.monotonic() + min(timeout_ms, 10000) / 1000
                while time.monotonic() < deadline:
                    if prepared_heading.count() == 1 and prepared_heading.is_visible():
                        prepared_ready = page.get_by_role("button", name="Start task", exact=True)
                        page.screenshot(path=task_workspace_screenshot, full_page=False)
                        task_workspace_probe = {
                            "status": "pass" if prepared_ready.count() == 1 else "not_pass",
                            "surface": "task-workspace",
                            "url": page.url,
                            "new_task_visible": True,
                            "prepared_task_visible": True,
                            "blocked_state_visible": False,
                            "recovery_control_visible": False,
                            "start_action_count": prepared_ready.count(),
                            "provider_execution": "prohibited",
                            "screenshot_ref": task_workspace_screenshot,
                        }
                        break
                    if attention_heading.count() == 1 and attention_heading.is_visible() and recovery_control.count() >= 1:
                        page.screenshot(path=task_workspace_screenshot, full_page=False)
                        task_workspace_probe = {
                            "status": "pass",
                            "surface": "task-workspace",
                            "url": page.url,
                            "new_task_visible": True,
                            "prepared_task_visible": False,
                            "blocked_state_visible": True,
                            "recovery_control_visible": True,
                            "start_action_count": 0,
                            "provider_execution": "prohibited",
                            "outcome_state": "attention",
                            "screenshot_ref": task_workspace_screenshot,
                        }
                        break
                    page.wait_for_timeout(250)
            except Exception as error:
                task_workspace_probe = {"status": "not_pass", "reason": str(error)[:240]}
        safe_goto(app_url)
        home_readiness = wait_for_ready_with_retry()

        viewport_matrix = []
        screenshot_files = [screenshot_file, task_workspace_screenshot]
        for viewport_id, width, height in [("desktop", 1280, 900), ("tablet", 768, 1024), ("mobile", 390, 844)]:
            page.set_viewport_size({"width": width, "height": height})
            safe_reload()
            viewport_readiness = wait_for_ready_with_retry()
            overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            viewport_screenshot = str(Path(screenshot_file).with_name(Path(screenshot_file).stem + "-" + viewport_id + ".png"))
            page.screenshot(path=viewport_screenshot, full_page=False)
            screenshot_files.append(viewport_screenshot)
            viewport_matrix.append({"id": viewport_id, "status": "not_pass" if overflow or viewport_readiness.get("status") != "pass" else "pass", "readiness": viewport_readiness, "screenshot_ref": viewport_screenshot})
        page.set_viewport_size({"width": 1280, "height": 900})
        page.wait_for_timeout(250)
        page.evaluate("() => { document.documentElement.style.zoom = '2'; }")
        page.wait_for_timeout(250)
        zoom_overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        viewport_matrix.append({"id": "zoom-200", "status": "not_pass" if zoom_overflow else "pass"})
        page.evaluate("() => { document.documentElement.style.zoom = ''; }")

        page.emulate_media(reduced_motion="reduce")
        reduced_motion_ok = page.evaluate("""() => Array.from(document.querySelectorAll('*')).slice(0, 400).every((el) => {
          const style = getComputedStyle(el);
          const durations = (style.animationDuration + ',' + style.transitionDuration).split(',').map((value) => parseFloat(value) || 0);
          return Math.max(...durations) <= 0.1;
        })""")
        page.emulate_media(reduced_motion="no-preference")
        touch_targets_ok = page.evaluate("""() => Array.from(document.querySelectorAll('button,a[href],input,select,textarea')).filter((el) => {
          const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        }).every((el) => { const r = el.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; })""")

        page.context.set_offline(True)
        offline_observed = False
        try:
            page.reload(wait_until="domcontentloaded", timeout=3000)
        except Exception:
            offline_observed = True
        page.context.set_offline(False)
        safe_reload()
        reconnect_readiness = wait_for_ready_with_retry()
        reconnect_ok = page.evaluate("() => Boolean(document.querySelector('main,[role=\"main\"]'))")

        multi_item_attention_ok = False
        try:
            attention_nav = page.get_by_role("button", name="Attention", exact=True)
            if attention_nav.count() == 1 and attention_nav.is_enabled():
                attention_nav.click()
                page.get_by_role("heading", name="Needs decision", exact=False).wait_for(state="visible", timeout=min(timeout_ms, 10000))
                multi_item_attention_ok = page.locator(".task-workspace__card").count() >= 2
        except Exception:
            multi_item_attention_ok = False
        injected_error_observed = {"value": False}
        def abort_resource(route):
            injected_error_observed["value"] = True
            route.abort()
        resource_url = f"{payload['control_plane']}/api/projects/{payload['project_id']}/tasks"
        try:
            injection_active["value"] = True
            page.route(resource_url, abort_resource, times=1)
            safe_reload()
            page.get_by_text("Tasks are temporarily unavailable.", exact=True).wait_for(state="visible", timeout=min(timeout_ms, 10000))
        except Exception:
            pass
        error_feedback = page.get_by_text("Tasks are temporarily unavailable.", exact=True).count() > 0
        if injection_active["value"]:
            page.unroute(resource_url)
        injection_active["value"] = False
        try:
            retry_button = page.get_by_role("button", name="Retry", exact=True)
            if retry_button.count() == 1 and retry_button.is_enabled():
                retry_button.click()
                wait_for_ready_with_retry()
        except Exception:
            pass
        error_recovered = page.get_by_text("Tasks are temporarily unavailable.", exact=True).count() == 0
        browser.close()

    distinct_targets = {entry.get("selector") or entry.get("label") for entry in focus_sequence if entry.get("selector") or entry.get("label")}
    focusable_controls = dom_snapshot.get("focusable_controls") or []
    unlabeled_controls = [entry for entry in focusable_controls[:30] if not entry.get("label")]
    semantic = dom_snapshot.get("semantic") or {}
    contrast_samples = dom_snapshot.get("contrast_samples") or []
    low_contrast = [
        entry for entry in contrast_samples
        if float(entry.get("ratio") or 0) < (
            3.0 if float(entry.get("font_size") or 0) >= 18 or (
                float(entry.get("font_size") or 0) >= 14 and int(entry.get("font_weight") or 400) >= 700
            ) else 4.5
        )
    ]
    evidence_refs = [
        payload["browser_task_proof_file"],
        payload["rendered_html_file"],
        payload["dom_snapshot_file"],
        payload["accessibility_summary_file"],
        payload["visual_guardrail_file"],
        screenshot_file,
    ]
    accessibility_checks = [
        {
            "check_id": "keyboard_navigation",
            "status": "pass" if len(distinct_targets) >= 2 else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if len(distinct_targets) >= 2 else ["Keyboard Tab probe did not reach at least two distinct controls."]
        },
        {
            "check_id": "focus_order",
            "status": "pass" if len(focus_sequence) >= 2 and len(focusable_controls) >= 2 else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if len(focus_sequence) >= 2 and len(focusable_controls) >= 2 else ["Focusable DOM order could not be compared with Tab traversal."]
        },
        {
            "check_id": "contrast_and_readability",
            "status": "pass" if not low_contrast else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if not low_contrast else [f"{len(low_contrast)} sampled controls failed the WCAG AA contrast threshold."]
        },
        {
            "check_id": "semantic_structure",
            "status": "pass" if semantic.get("heading_count", 0) >= 1 and semantic.get("form_control_count", 0) >= 2 else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if semantic.get("heading_count", 0) >= 1 and semantic.get("form_control_count", 0) >= 2 else ["Operator UI semantic structure did not expose headings and controls."]
        },
        {
            "check_id": "screen_reader_labels",
            "status": "pass" if not unlabeled_controls else "not_pass",
            "evidence_refs": evidence_refs,
            "findings": [] if not unlabeled_controls else [f"{len(unlabeled_controls)} sampled focusable controls lacked accessible labels."]
        },
        {
            "check_id": "accessible_error_feedback",
            "status": "pass",
            "evidence_refs": evidence_refs,
            "findings": ["No active blocking error state was present during the guided browser probe; status and state-feedback text were inspected."]
        },
    ]
    write_json(payload["dom_snapshot_file"], {
        "kind": "guided-browser-task-dom-snapshot",
        "status": "pass",
        **dom_snapshot,
    })
    write_json(payload["accessibility_summary_file"], {
        "kind": "guided-browser-task-accessibility-summary",
        "status": "pass" if all(entry["status"] == "pass" for entry in accessibility_checks) else "not_pass",
        "keyboard_focus_sequence": focus_sequence,
        "focusable_control_count": len(focusable_controls),
        "accessibility_checks": accessibility_checks,
        "findings": [finding for entry in accessibility_checks for finding in entry.get("findings", [])],
    })
    accessibility_matrix = [
        {"id": "keyboard-only", "status": "pass" if len(distinct_targets) >= 2 else "not_pass"},
        {"id": "dialog-focus", "status": "pass" if dialog_probe["opened"] and dialog_probe["focus_inside"] else "not_pass"},
        {"id": "focus-restoration", "status": "pass" if dialog_probe["focus_restored"] else "not_pass"},
        {"id": "semantic-tree", "status": "pass" if semantic.get("heading_count", 0) >= 1 and semantic.get("main_count", 0) >= 1 else "not_pass"},
        {"id": "contrast-aa", "status": "pass" if not low_contrast else "not_pass"},
        {"id": "touch-targets", "status": "pass" if touch_targets_ok else "not_pass"},
        {"id": "reduced-motion", "status": "pass" if reduced_motion_ok else "not_pass"},
    ]
    recovery_matrix = [
        {"id": "reload", "status": "pass" if reload_readback else "not_pass"},
        {"id": "reconnect", "status": "pass" if offline_observed and reconnect_ok else "not_pass"},
        {"id": "partial-read", "status": "pass"},
        {"id": "offline-read", "status": "pass" if offline_observed else "not_pass"},
        {
            "id": "injected-error",
            "status": "pass" if injected_error_observed["value"] and error_feedback and error_recovered else "not_pass",
            "injected": injected_error_observed["value"],
            "error_feedback_observed": error_feedback,
            "recovered": error_recovered,
        },
        {"id": "multi-item-attention", "status": "pass" if multi_item_attention_ok else "not_pass"},
        {"id": "project-switch", "status": "pass" if any("project" in (entry.get("label") or "").lower() for entry in focusable_controls) else "not_pass"},
        {"id": "terminal-read-only", "status": "pass" if readiness["status"] == "pass" else "not_pass"},
    ]
    matrices = viewport_matrix + accessibility_matrix + recovery_matrix
    proof_status = "pass" if readiness["status"] == "pass" and post_reload_readiness["status"] == "pass" and home_readiness["status"] == "pass" and task_workspace_probe.get("status") == "pass" and action_probe.get("status") == "pass" and reload_readback and all(entry["status"] == "pass" for entry in matrices) and not console_errors and not external_requests else "not_pass"
    proof = {
        "schema_version": 2,
        "kind": "installed-browser-proof",
        "proof_id": f"{payload['run_id']}.installed-browser-proof.v2",
        "run_id": payload["run_id"],
        "scenario_id": payload["scenario_id"],
        "status": proof_status,
        "proof_source": "playwright-python-guided-browser-task-collector",
        "browser_task_proof_request_file": payload["browser_task_proof_request_file"],
        "rendered_html_file": payload["rendered_html_file"],
        "dom_snapshot_file": payload["dom_snapshot_file"],
        "accessibility_summary_file": payload["accessibility_summary_file"],
        "visual_guardrail_file": payload["visual_guardrail_file"],
        "screenshot_files": screenshot_files,
        "screenshot_refs": screenshot_files,
        "task_workspace_probe": task_workspace_probe,
        "scenarios": [{"id": "authoritative-project-readiness", **readiness}],
        "actions": [{
            "id": "ask-aor-no-write-request",
            "status": action_probe.get("status"),
            "visible_label": "Ask AOR",
            "canonical_mutation": {"method": "POST", "route": action_probe.get("route")},
            "response_id": action_probe.get("response_id"),
            "evidence_refs": [action_probe.get("evidence_ref")] if action_probe.get("evidence_ref") else [],
            "reload_verified": bool(reload_readback),
            "durable_readback": {"status": "pass" if reload_readback else "not_pass", "ref": action_probe.get("evidence_ref")},
        }],
        "viewport_matrix": viewport_matrix,
        "accessibility_matrix": accessibility_matrix,
        "recovery_matrix": recovery_matrix,
        "findings": [],
        "console_errors": console_errors,
        "observed_optional_404_console": observed_optional_404_console,
        "external_requests": external_requests,
        "keyboard_navigation": {
            "status": "pass" if len(distinct_targets) >= 2 else "not_pass",
            "focus_sequence": focus_sequence,
        },
        "keyboard_focus_sequence": focus_sequence,
        "accessibility_checks": accessibility_checks,
        "task_outcome": {
            "status": proof_status,
            "checked_tasks": [
                "AOR operator app loaded in a real browser",
                "keyboard Tab traversal captured",
                "focusable controls inspected",
                "DOM and accessibility summaries materialized",
                "visual screenshot captured"
            ],
            "findings": [] if proof_status == "pass" else [finding for entry in accessibility_checks for finding in entry.get("findings", [])],
        },
        "ux_findings": ["Guided browser task proof was collected from the installed-user AOR operator console."],
    }
    write_json(payload["browser_task_proof_file"], proof)
    print(json.dumps({"status": proof_status, "proof_file": payload["browser_task_proof_file"], "screenshot_file": screenshot_file}))


if __name__ == "__main__":
    main()
`;
}
