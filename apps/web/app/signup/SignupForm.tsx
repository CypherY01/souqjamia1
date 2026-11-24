"use client";

// The signup form (task 3.2, item 8, plan/screens.md): FR01, DEC26, DEC32, DEC36, DEC63, DEC64.
// The same field rules run here first (packages/domain), so most mistakes show before a request;
// the server stays the authority and its field errors are shown the same way, all at once
// (TC01), with focus on the first field in error.
//   200  confirmation off: a new CSRF token on the next request, then the home page, where the
//        site header shows the member (DEC63).
//   202  confirmation on: "check your email", with the resend form (API005).
//   422  field errors; versions that changed meanwhile fetch API114 again and clear both boxes.
//   403  CAPTCHA_FAILED resets the widget. 429 shows the wait, 503 and the network a retry.
import { useRef, useState, type SubmitEvent } from "react";
import { checkPassword, parseDisplayName, parseEmail } from "@souq/domain";
import { t } from "@souq/i18n";
import { FailureAlert, fieldMessage } from "../../components/auth/messages";
import { ResendForm } from "../../components/auth/ResendForm";
import { Turnstile, type TurnstileHandle } from "../../components/auth/Turnstile";
import { Alert } from "../../components/ui/Alert";
import { SubmitButton } from "../../components/ui/SubmitButton";
import { Checkbox, Select, TextField } from "../../components/ui/Field";
import { PasswordField } from "../../components/ui/PasswordField";
import { api, type ApiFailure } from "../../lib/client/api";
import { clearSellDraft } from "../../lib/client/sell-draft";
import { routes } from "../../lib/routes";
import styles from "./signup.module.css";

export interface SignupPolicies {
  terms: string;
  privacy: string;
}

interface SignupFormProps {
  siteKey: string;
  policies: SignupPolicies;
  colleges: readonly { value: string; label: string }[];
}

type FieldErrors = Partial<Record<string, string>>;

/** The order of the fields on the page: focus goes to the first one in error. */
const FIELD_IDS: readonly [field: string, id: string][] = [
  ["name", "signup-name"],
  ["email", "signup-email"],
  ["password", "signup-password"],
  ["college_id", "signup-college"],
  ["accept_terms", "signup-terms"],
  ["acknowledge_privacy", "signup-privacy"],
];

function focusFirst(errors: FieldErrors): void {
  const first = FIELD_IDS.find(([field]) => errors[field] !== undefined);
  if (first !== undefined) document.getElementById(first[1])?.focus();
}

/** A text field of the form ("" when absent). */
function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function localErrors(form: FormData): FieldErrors {
  const errors: FieldErrors = {};
  const name = parseDisplayName(formText(form, "name"));
  if (!name.ok) errors.name = fieldMessage("name", name.error);
  const email = parseEmail(formText(form, "email"));
  if (!email.ok) errors.email = fieldMessage("email", email.error);
  const password = checkPassword(formText(form, "password"));
  if (password !== null) errors.password = fieldMessage("password", password);
  if (form.get("accept_terms") !== "on")
    errors.accept_terms = fieldMessage("accept_terms", "required");
  if (form.get("acknowledge_privacy") !== "on") {
    errors.acknowledge_privacy = fieldMessage("acknowledge_privacy", "required");
  }
  return errors;
}

interface PolicyVersions {
  terms: { version: string };
  privacy: { version: string };
}

export function SignupForm({ siteKey, policies: initialPolicies, colleges }: SignupFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const captcha = useRef<TurnstileHandle>(null);
  const [policies, setPolicies] = useState(initialPolicies);
  const [token, setToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [emailRegistered, setEmailRegistered] = useState(false);
  const [policiesChanged, setPoliciesChanged] = useState(false);
  const [captchaPending, setCaptchaPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function refreshPolicies(): Promise<void> {
    const result = await api.request<PolicyVersions>("/api/policies/current", { method: "GET" });
    if (result.ok) {
      setPolicies({ terms: result.data.terms.version, privacy: result.data.privacy.version });
    }
    // Item 8: both boxes start unticked again for the new versions.
    const form = formRef.current;
    for (const name of ["accept_terms", "acknowledge_privacy"]) {
      const box = form?.elements.namedItem(name);
      if (box instanceof HTMLInputElement) box.checked = false;
    }
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFailure(null);
    setEmailRegistered(false);
    setPoliciesChanged(false);
    setCaptchaPending(false);
    const found = localErrors(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    if (token === null) {
      setCaptchaPending(true);
      return;
    }

    setSubmitting(true);
    const college = formText(form, "college_id");
    const email = formText(form, "email").trim();
    const result = await api.request<{ state: string; next: string }>("/api/auth/signup", {
      body: {
        name: formText(form, "name"),
        email,
        password: formText(form, "password"),
        college_id: college === "" ? null : college,
        terms_version: policies.terms,
        privacy_version: policies.privacy,
        accept_terms: true,
        acknowledge_privacy: true,
        captcha_token: token,
      },
    });

    if (result.ok && result.status === 200) {
      // DEC63: signed in. The CSRF binding changed (task 1.6), and a full load shows the header.
      api.resetCsrfToken();
      // TC82 (task 4.2): the tab's wizard draft never outlives the session that wrote it.
      clearSellDraft();
      window.location.assign(result.data.next);
      return;
    }
    setSubmitting(false);
    // A token is spent by every call that reached Supabase Auth.
    captcha.current?.reset();
    if (result.ok) {
      setSentTo(email);
      return;
    }
    if (result.code === "VALIDATION_FAILED" && result.fieldErrors.length > 0) {
      const next: FieldErrors = {};
      let changed = false;
      for (const { field, code } of result.fieldErrors) {
        if (code === "not_current") changed = true;
        else next[field] ??= fieldMessage(field, code);
        if (field === "email" && code === "email_registered") setEmailRegistered(true);
      }
      if (changed) {
        setPoliciesChanged(true);
        await refreshPolicies();
      }
      setErrors(next);
      focusFirst(next);
      if (changed && Object.keys(next).length === 0) {
        document.getElementById("signup-terms")?.focus();
      }
      return;
    }
    setFailure(result);
  }

  if (sentTo !== null) {
    return (
      <div className={styles.sent}>
        <Alert variant="success" title={t("auth.signup.checkEmail.title")} live>
          <p>{t("auth.signup.checkEmail.body")}</p>
          <p>{t("auth.signup.checkEmail.registered")}</p>
        </Alert>
        <ResendForm siteKey={siteKey} email={sentTo} />
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      className={styles.form}
      method="post"
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      {failure !== null && <FailureAlert title={t("auth.signup.formError")} failure={failure} />}
      {policiesChanged && (
        <Alert variant="warning" title={t("ui.alert.warning")} live>
          {t("auth.signup.policiesChanged")}
        </Alert>
      )}

      <TextField
        id="signup-name"
        name="name"
        label={t("auth.signup.name.label")}
        hint={t("auth.signup.name.hint")}
        error={errors.name}
        autoComplete="name"
      />
      <TextField
        id="signup-email"
        name="email"
        type="email"
        dir="ltr"
        label={t("auth.signup.email.label")}
        hint={t("auth.signup.email.hint")}
        error={errors.email}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
      />
      {emailRegistered && (
        <p className={styles.registeredLinks}>
          <a href={routes.login}>{t("auth.signup.emailRegistered.login")}</a>
          <a href={routes.recover}>{t("auth.signup.emailRegistered.recover")}</a>
        </p>
      )}
      <PasswordField
        id="signup-password"
        name="password"
        label={t("auth.signup.password.label")}
        hint={t("auth.signup.password.hint")}
        error={errors.password}
        autoComplete="new-password"
      />
      <Select
        id="signup-college"
        name="college_id"
        label={t("auth.signup.college.label")}
        hint={t("auth.signup.college.hint")}
        error={errors.college_id}
        placeholder={t("auth.signup.college.placeholder")}
        options={colleges}
        optional
      />

      <Checkbox
        id="signup-terms"
        name="accept_terms"
        label={t("auth.signup.terms.label")}
        error={errors.accept_terms}
        extra={
          <a href={routes.terms} target="_blank" rel="noopener">
            {t("auth.signup.terms.link")}
            <span className="visually-hidden"> {t("ui.newTab")}</span>
          </a>
        }
      />
      <Checkbox
        id="signup-privacy"
        name="acknowledge_privacy"
        label={t("auth.signup.privacy.label")}
        error={errors.acknowledge_privacy}
        extra={
          <a href={routes.privacy} target="_blank" rel="noopener">
            {t("auth.signup.privacy.link")}
            <span className="visually-hidden"> {t("ui.newTab")}</span>
          </a>
        }
      />

      <Turnstile ref={captcha} siteKey={siteKey} onToken={setToken} />
      {captchaPending && (
        <p className={styles.pending} role="status">
          {t("auth.captcha.pending")}
        </p>
      )}

      <SubmitButton fullWidth loading={submitting} loadingLabel={t("auth.signup.submitting")}>
        {t("auth.signup.submit")}
      </SubmitButton>
    </form>
  );
}
