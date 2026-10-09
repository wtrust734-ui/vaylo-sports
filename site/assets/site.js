/* ==========================================================================
   VAYLO SPORTS — WEBSITE BEHAVIOUR
   --------------------------------------------------------------------------
   Two jobs, both of which exist because the alternative is a website that
   looks functional and is not.

   1. The mobile navigation drawer.
   2. The forms.
   3. The cookie and storage notice.

   On (2), the rule this file is built around: a form must never report success
   it did not have. If the submission ends in an error — the endpoint is not
   deployed, the network is down, the server said no — the person is told that
   it failed, in the same place and in the same tone as success, and is given a
   route that will actually reach us. Nothing here ever shows a green tick for
   a message that was not stored.

   The endpoint is injected at build time into /assets/config.js. When it is
   absent, the forms render in "email only" mode from the start rather than
   failing on submit, so nobody fills in a form that was never going to work.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------------- nav -- */

  function initNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var drawer = document.getElementById("mobile-nav");
    if (!toggle || !drawer) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      drawer.hidden = !open;
    }

    setOpen(false);

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    // Escape closes and returns focus to the control that opened it, so a
    // keyboard user is never left somewhere they cannot see.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });

    // Following a link inside the drawer should leave it closed behind you.
    drawer.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });
  }

  /* -------------------------------------------------------------- forms -- */

  /**
   * Field-level validation, run before anything is sent.
   *
   * Deliberately shallow. The real validation is on the server, and duplicating
   * rules here would create a second place for them to be wrong. This only
   * catches what a person would obviously have mistyped, and says so in the
   * message rather than silently refusing to submit.
   */
  function validate(form) {
    var errors = [];

    var email = form.querySelector('input[type="email"]');
    if (email) {
      var value = (email.value || "").trim();
      if (!value) {
        errors.push({ field: email, message: "Please enter an email address we can reply to." });
      } else if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) {
        errors.push({ field: email, message: "That does not look like an email address." });
      }
    }

    var body = form.querySelector("textarea[data-body]");
    if (body) {
      var text = (body.value || "").trim();
      if (text.length < 10) {
        errors.push({ field: body, message: "Please describe the issue in a little more detail." });
      } else if (text.length > 8000) {
        errors.push({ field: body, message: "That is too long. Please shorten it, or email us instead." });
      }
    }

    return errors;
  }

  /** Mark a field invalid and put the message where a screen reader will read it. */
  function showFieldError(field, message) {
    var id = field.id + "-error";
    var target = document.getElementById(id);
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", id);
    if (target) target.textContent = message;
  }

  function clearErrors(form) {
    var fields = form.querySelectorAll("[aria-invalid]");
    for (var i = 0; i < fields.length; i++) {
      fields[i].removeAttribute("aria-invalid");
    }
    var messages = form.querySelectorAll(".field-error");
    for (var j = 0; j < messages.length; j++) messages[j].textContent = "";
  }

  function setStatus(form, kind, html) {
    var status = form.querySelector("[data-status]");
    if (!status) return;
    status.className = "form-status" + (kind ? " is-" + kind : "");
    status.innerHTML = html;
  }

  /**
   * Validation for the sponsorship questionnaire.
   *
   * Separate from validate() because the fields are different in kind: there is
   * no message body, there is a company name, and there is a required terms
   * acceptance. Shallow here on purpose — the server validates for real, and a
   * second copy of those rules is a second place for them to be wrong.
   */
  function validateSponsor(form) {
    var errors = [];

    var brand = form.querySelector('[name="brand_name"]');
    if (brand && !(brand.value || "").trim()) {
      errors.push({ field: brand, message: "Please tell us the brand or company name." });
    }

    var email = form.querySelector('[name="contact_email"]');
    var value = email ? (email.value || "").trim() : "";
    if (!value) {
      errors.push({ field: email, message: "Please enter an email address we can reply to." });
    } else if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) {
      errors.push({ field: email, message: "That does not look like an email address." });
    }

    // Read from .checked, never from .value. An unticked checkbox still has a
    // value of "yes", and accepting it would record a terms acceptance that
    // never happened — the one mistake in this file that would matter legally
    // rather than cosmetically.
    var terms = form.querySelector('[name="terms_accepted"]');
    if (!terms || !terms.checked) {
      errors.push({ field: terms, message: "Please accept the enquiry terms before sending." });
    }

    return errors;
  }

  /**
   * Build the sponsorship payload.
   *
   * Not the generic "send every named control" loop the other forms use,
   * because three of these fields are not scalars: the interests are an object
   * of booleans (so unticking a box means "no", not "absent"), the sports are
   * only the ticked ones, and regions is free text the server splits again.
   */
  function sponsorPayload(form) {
    var val = function (selector) {
      var el = form.querySelector(selector);
      return el ? (el.value || "").trim() : "";
    };

    var interests = {};
    Array.prototype.forEach.call(form.querySelectorAll('input[name="interests"]'), function (box) {
      interests[box.value] = !!box.checked;
    });

    var sports = [];
    Array.prototype.forEach.call(form.querySelectorAll('input[name="sports"]'), function (box) {
      if (box.checked) sports.push(box.value);
    });

    var terms = form.querySelector('[name="terms_accepted"]');

    return {
      brand_name: val('[name="brand_name"]'),
      website: val('[name="website"]'),
      contact_name: val('[name="contact_name"]'),
      contact_email: val('[name="contact_email"]'),
      goals: val('[name="goals"]'),
      terms_version: val('[name="terms_version"]'),
      company_website: val('[name="company_website"]'),
      terms_accepted: !!(terms && terms.checked),
      interests: interests,
      sports: sports,
      regions: val('[name="regions_text"]')
        .split(",")
        .map(function (r) { return r.trim(); })
        .filter(Boolean),
    };
  }

  /**
   * The sponsorship questionnaire, shown one step at a time.
   *
   * Progressive enhancement, and the direction matters: without this the form is
   * one long fieldset and it still submits. The steps are a presentation, so a
   * brand on a browser that blocks scripts still gets a working form rather than
   * a blank panel. `data-quiz-ready` is what tells the stylesheet to start
   * hiding inactive steps, so nothing is hidden until this function has run and
   * can show it again.
   */
  function initQuiz() {
    var forms = document.querySelectorAll('form[data-vaylo-form="sponsor"]');

    Array.prototype.forEach.call(forms, function (form) {
      var steps = form.querySelectorAll("[data-quiz-step]");
      if (steps.length < 2) return;

      var bar = form.querySelector("[data-quiz-progress]");
      var back = form.querySelector("[data-quiz-back]");
      var submit = form.querySelector('button[type="submit"]');
      var summary = form.querySelector("[data-quiz-summary]");

      var next = document.createElement("button");
      next.type = "button";
      next.className = "btn btn-primary";
      next.textContent = "Next";
      if (submit && submit.parentNode) submit.parentNode.insertBefore(next, submit);

      var index = 0;

      function show(target) {
        index = Math.max(0, Math.min(steps.length - 1, target));
        Array.prototype.forEach.call(steps, function (step, n) {
          if (n === index) step.setAttribute("data-active", "true");
          else step.removeAttribute("data-active");
        });
        if (bar) bar.style.width = Math.round(((index + 1) / steps.length) * 100) + "%";
        if (back) back.hidden = index === 0;
        if (next) next.hidden = index === steps.length - 1;
        if (index === steps.length - 1 && summary) summary.innerHTML = summaryHtml(form);

        // Move focus to the step that just appeared, or a keyboard user is left
        // behind on a control that is no longer visible.
        var legend = steps[index].querySelector("legend");
        if (legend) {
          legend.setAttribute("tabindex", "-1");
          legend.focus();
        }
      }

      /** What the brand is about to send, read back from the form itself. */
      function summaryHtml(scope) {
        var lines = [];

        var brand = scope.querySelector('[name="brand_name"]');
        var email = scope.querySelector('[name="contact_email"]');
        if (brand && brand.value.trim()) {
          lines.push("<li><strong>" + escapeHtml(brand.value.trim()) + "</strong>" +
            (email && email.value.trim() ? " &middot; " + escapeHtml(email.value.trim()) : "") + "</li>");
        }

        // Interest labels are read out of the option's own markup, so this
        // summary cannot drift from the question it is summarising.
        var picked = [];
        Array.prototype.forEach.call(scope.querySelectorAll('input[name="interests"]'), function (box) {
          if (!box.checked) return;
          var label = scope.querySelector('label[for="' + box.id + '"]');
          var title = label ? label.querySelector(".choice-title") : null;
          var tag = label ? label.querySelector(".choice-tag") : null;
          picked.push(
            escapeHtml(title ? title.textContent : box.value) +
              (tag ? ' <span class="choice-tag is-muted">' + escapeHtml(tag.textContent) + "</span>" : "")
          );
        });
        lines.push(
          "<li>Wants: " + (picked.length ? picked.join(", ") : "<em>nothing selected yet</em>") + "</li>"
        );

        var sports = [];
        Array.prototype.forEach.call(scope.querySelectorAll('input[name="sports"]'), function (box) {
          if (box.checked) sports.push(box.value);
        });
        lines.push("<li>Sports: " + (sports.length ? escapeHtml(sports.join(", ")) : "every sport") + "</li>");

        return "<p class=\"quiz-summary-title\">Sending</p><ul class=\"prose-list\">" + lines.join("") + "</ul>";
      }

      if (back) {
        back.addEventListener("click", function () { show(index - 1); });
      }

      next.addEventListener("click", function () {
        clearErrors(form);
        // Only the fields on this step can block the step, so a brand is not
        // sent back two steps for something it has not reached yet.
        var problems = validateSponsor(form).filter(function (problem) {
          return problem.field && steps[index].contains(problem.field);
        });
        if (problems.length) {
          for (var i = 0; i < problems.length; i++) {
            showFieldError(problems[i].field, problems[i].message);
          }
          setStatus(form, "error", "<p><strong>Nothing was sent.</strong> Please complete the highlighted field.</p>");
          if (problems[0].field && problems[0].field.focus) problems[0].field.focus();
          return;
        }
        setStatus(form, null, "");
        show(index + 1);
      });

      form.setAttribute("data-quiz-ready", "true");
      show(0);
    });
  }

  /** Minimal HTML escape for text read back out of the DOM. */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initForms() {
    // Read the config HERE, not at parse time.
    //
    // config.js and this file are both `defer`, and deferred scripts run in
    // document order — so config.js is guaranteed to have executed by
    // DOMContentLoaded, but not at the moment this IIFE's top-level code runs.
    // Reading it at the top level produced an empty object, and the fallback
    // that is supposed to show the support email instead showed no email.
    var config = window.VAYLO_SITE_CONFIG || {};

    var forms = document.querySelectorAll("form[data-vaylo-form]");
    var endpoint = config.supportEndpoint || null;
    var contactEmail = config.contactEmail || "";

    Array.prototype.forEach.call(forms, function (form) {
      var submit = form.querySelector('button[type="submit"]');
      var categoryField = form.querySelector('[name="category"]');

      // ------------------------------------------------------------------
      // Which endpoint this form posts to.
      //
      // A form declares its own destination with the attribute's value, rather
      // than every form on the site sharing one endpoint. The waiting list is
      // not a support message: it has different validation, a different rate
      // limit, and a completely different reason for not telling the sender
      // what the server already knows (a support reply can quote a reference; a
      // signup must not confirm whether an address is already registered).
      // ------------------------------------------------------------------
      var kind = form.getAttribute("data-vaylo-form") || "support";
      var isWaitlist = kind === "waitlist";
      var isSponsor = kind === "sponsor";
      var endpoint = isWaitlist
        ? config.waitlistEndpoint || null
        : isSponsor
          ? config.sponsorEndpoint || null
          : config.supportEndpoint || null;

      // ------------------------------------------------------------------
      // No endpoint configured. Disable the form, say why, and point at the
      // inbox that does work. A live form that silently discards a message is
      // worse than a visibly unavailable one.
      // ------------------------------------------------------------------
      if (!endpoint) {
        form.setAttribute("data-unavailable", "true");
        if (submit) {
          submit.disabled = true;
          submit.setAttribute("aria-disabled", "true");
        }
        setStatus(
          form,
          "error",
          isSponsor
            ? "<p><strong>The sponsor questionnaire is not available yet.</strong></p>" +
              "<p>We have not finished wiring it up, so your answers would not be " +
              "stored and we will not pretend otherwise. Please email " +
              (contactEmail
                ? '<a href="mailto:' + contactEmail + '">' + contactEmail + "</a>"
                : "the address on the Contact page") +
              " and tell us directly — it reaches a person.</p>"
            : isWaitlist
            ? "<p><strong>The waiting list is not available yet.</strong></p>" +
              "<p>We have not finished wiring this form up, so your address would " +
              "not be stored and we will not pretend otherwise. You can email " +
              (contactEmail
                ? '<a href="mailto:' + contactEmail + '">' + contactEmail + "</a>"
                : "the address on the Contact page") +
              " and ask to be added by hand — a person will do it.</p>"
            : "<p><strong>The online form is not available yet.</strong></p>" +
              "<p>We have not finished wiring this form up, so it would not reach us " +
              "and we will not pretend otherwise. Please email " +
              (contactEmail
                ? '<a href="mailto:' + contactEmail + '">' + contactEmail + "</a>"
                : "the address on the Contact page") +
              " instead — it reaches a person, and you will get a reply.</p>"
        );
        return;
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        clearErrors(form);

        var problems = isSponsor ? validateSponsor(form) : validate(form);
        if (problems.length) {
          for (var i = 0; i < problems.length; i++) {
            showFieldError(problems[i].field, problems[i].message);
          }
          setStatus(
            form,
            "error",
            "<p><strong>Nothing was sent.</strong> Please check the highlighted field and try again.</p>"
          );
          if (problems[0].field.focus) problems[0].field.focus();
          return;
        }

        var payload;
        if (isSponsor) {
          // Three of these fields are not scalars, and an unticked checkbox
          // still carries a value — so the generic loop below would both lose
          // the interests and claim a terms acceptance that never happened.
          payload = sponsorPayload(form);
        } else {
          payload = {};
          var controls = form.querySelectorAll("input, select, textarea");
          Array.prototype.forEach.call(controls, function (control) {
            if (!control.name) return;
            // The honeypot is sent as well: a bot that fills it is stopped
            // server-side, and a person never fills it.
            payload[control.name] = control.value;
          });
          if (categoryField) payload.category = categoryField.value;
        }

        var originalText = submit ? submit.textContent : "";
        if (submit) {
          submit.disabled = true;
          submit.textContent = "Sending…";
        }
        setStatus(
          form,
          null,
          isSponsor
            ? "<p>Sending your enquiry…</p>"
            : isWaitlist
              ? "<p>Adding you…</p>"
              : "<p>Sending your message…</p>"
        );

        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (response) {
            return response
              .json()
              .catch(function () {
                return {};
              })
              .then(function (data) {
                return { ok: response.ok, status: response.status, data: data || {} };
              });
          })
          .then(function (result) {
            if (!result.ok) {
              var message =
                (result.data && result.data.message) ||
                (isWaitlist
                  ? "Something went wrong and your address was not stored."
                  : "The message could not be sent. Nothing has been received.");
              setStatus(
                form,
                "error",
                "<p><strong>Nothing was sent.</strong> " +
                  message +
                  (contactEmail
                    ? ' You can email <a href="mailto:' +
                      contactEmail +
                      '">' +
                      contactEmail +
                      "</a> instead.</p>"
                    : "</p>")
              );
              if (submit) {
                submit.disabled = false;
                submit.textContent = originalText;
              }
              return;
            }

            // Genuine success. The server has stored the row and returned a
            // reference — this is the only path in this file that clears the
            // form, and it is reached only on a 2xx from the real endpoint.
            var reference = (result.data && result.data.reference) || "";
            var serverMessage = (result.data && result.data.message) || "";

            if (isSponsor) {
              // The enquiry was stored and the operator was notified. Never
              // says a deal, a price, a reservation or a reply time — the
              // operator reads these by hand, so the only honest promise is
              // that a person will read it.
              setStatus(
                form,
                "ok",
                "<p><strong>Enquiry received.</strong> A person will read it and " +
                  "reply to the address you gave. Keep this reference:</p>" +
                  '<p><span class="ref">' + reference + "</span></p>" +
                  "<p>Nothing is reserved and nothing has been charged. If it is " +
                  'urgent, <a href="/contact/">contact us directly</a>.</p>'
              );
            } else if (isWaitlist) {
              // No reference, and nothing that echoes back what we stored. A
              // signup confirmation has to look identical whether this was the
              // first time or the fifth, or the page becomes a way of checking
              // whether somebody is on the list.
              setStatus(
                form,
                "ok",
                "<p><strong>You are on the list.</strong> Your address has been " +
                  "stored. If you change your mind, " +
                  '<a href="/contact/">tell us</a> and we will delete it.</p>'
              );
            } else {
              setStatus(
                form,
                "ok",
                "<p><strong>Received.</strong> " +
                  (serverMessage ? serverMessage + " " : "") +
                  "Keep this reference if you need to refer to the message:</p>" +
                  '<p><span class="ref">' + reference + "</span></p>"
              );
            }
            form.reset();
            if (submit) {
              submit.disabled = false;
              submit.textContent = originalText;
            }
          })
          .catch(function () {
            // Network failure, DNS failure, offline. Still a failure, still
            // said so. Never treated as success.
            setStatus(
              form,
              "error",
              "<p><strong>Nothing was sent.</strong> The connection failed before we could " +
                "reach the server, so " +
                (isWaitlist
                  ? "your address has not been stored."
                  : "your message has not been received.") +
                (contactEmail
                  ? ' Please email <a href="mailto:' +
                    contactEmail +
                    '">' +
                    contactEmail +
                    "</a> instead.</p>"
                  : "</p>")
            );
            if (submit) {
              submit.disabled = false;
              submit.textContent = originalText;
            }
          });
      });
    });
  }

  /* ------------------------------------------------- cookie and storage -- */

  /**
   * The key and the version of the notice the reader is acknowledging.
   *
   * Both live here, in one place, and the version is stored alongside the
   * acknowledgement rather than used as a boolean. A change to what the site
   * stores on a device is a change worth telling people about, so bumping this
   * string re-shows the notice to everyone — which a stored `true` could not do.
   */
  var COOKIE_NOTICE_KEY = "vaylo:cookie-notice";
  var COOKIE_NOTICE_VERSION = "2026-10-07";

  /**
   * Reveal the cookie notice unless this device has already acknowledged it.
   *
   * Three deliberate properties:
   *
   *   1. It never blocks anything. Nothing on this site waits for the button:
   *      no cookie is set by this site at all, and no script here is gated on
   *      it. A notice that gated functionality would be a consent gate, and a
   *      consent gate for strictly necessary storage would be dishonest.
   *   2. Storage being unavailable is not treated as "already accepted". If we
   *      cannot remember the choice we show the notice again, rather than
   *      silently deciding on the reader's behalf.
   *   3. Failing to write does not hide the notice as though it had been
   *      stored, so the button never claims to have saved something it did not.
   */
  function initCookieNotice() {
    var notice = document.querySelector("[data-cookie-notice]");
    if (!notice) return;

    var accept = notice.querySelector("[data-cookie-accept]");
    var remembered = null;

    try {
      remembered = window.localStorage.getItem(COOKIE_NOTICE_KEY);
    } catch (e) {
      // Blocked or unavailable. Leave `remembered` null so the notice shows.
      remembered = null;
    }

    if (remembered !== COOKIE_NOTICE_VERSION) notice.hidden = false;

    if (!accept) return;

    accept.addEventListener("click", function () {
      try {
        window.localStorage.setItem(COOKIE_NOTICE_KEY, COOKIE_NOTICE_VERSION);
      } catch (e) {
        // Nothing to do about it, and nothing to say: the notice stays on
        // screen for next time, which is the honest outcome.
      }
      notice.hidden = true;
    });
  }

  /* --------------------------------------------------------------- init -- */

  function init() {
    initNav();
    initForms();
    initQuiz();
    initCookieNotice();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();