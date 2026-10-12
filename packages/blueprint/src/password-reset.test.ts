import { describe, expect, it } from "vitest";

import { isPasswordResetUrl, readsAsPasswordReset } from "./password-reset.js";

describe("a portal's \"Forgot password\", recognised (P301)", () => {
  // Vahid, 2026-10-12: "The run must never press "Forgot password" itself: it
  // silently replaces the student's password and puts a new one in their inbox
  // in plain text." Wide on purpose: a false positive costs a review, a false
  // negative a student's password.
  it.each([
    ["Sheffield's reset page, as the 2026-09-11 read recorded it", "https://www.sheffield.ac.uk/postgradapplication/forgottenPassword.do"],
    ["Salesforce's", "https://apply.example.test/s/login/ForgotPassword"],
    ["a reset named in the query", "https://apply.example.test/account?action=resetPassword"],
    ["a reset spelt with a hyphen", "https://apply.example.test/password-reset"],
    ["an encoded one", "https://apply.example.test/%66orgot"],
    ["a relative form action", "/postgradapplication/forgottenPassword.do"],
    // P301's review: shapes that name the password and were missed.
    ["a framework's default route", "https://apply.example.test/password/reset"],
    ["the words the other way round", "https://apply.example.test/password-recovery"],
    ["a reset written with an underscore", "https://apply.example.test/reset_password"],
  ])("reads %s as a reset", (_, url) => {
    expect(isPasswordResetUrl(url)).toBe(true);
  });

  it.each([
    ["Sheffield's login page", "https://www.sheffield.ac.uk/postgradapplication/"],
    ["a form page", "https://www.sheffield.ac.uk/postgradapplication/personal.do"],
    ["a page whose host says reset", "https://reset.example.test/apply"],
  ])("does not read %s as a reset", (_, url) => {
    expect(isPasswordResetUrl(url)).toBe(false);
  });

  it("reads the words a reset control carries, and not those of the controls the run does press", () => {
    for (const words of ["Forgotten Password", "Forgot your password?", "Reset password", "forgotPasswordLink", "resetPasswordBtn", "Lost your password", "Password reset"]) {
      expect(readsAsPasswordReset(words), words).toBe(true);
    }
    // P301's review: identifiers spelt with a hyphen or an underscore, and the
    // words of a reset that sends a new password, as Sheffield's does.
    for (const words of ["reset-password", "reset_password", "password-reset", "lost-password", "recover-password", "#reset-password", "a.recover-password", "Password recovery", "Request a new password", "Send me a new password", "E-mail me a new password"]) {
      expect(readsAsPasswordReset(words), words).toBe(true);
    }
    // Sheffield's own controls, as the signed entry records them, and an
    // input of type reset, which clears a form and is not a password reset.
    for (const words of ["loginBtn", "Sign in", "startApplicationBtn", "Start Application", "saveBtn", "Save", "Reset", "sendBtn", "Password", "Confirm password", "Choose a new password", "password_confirm", "New Applicants", "Create account"]) {
      expect(readsAsPasswordReset(words), words).toBe(false);
    }
  });
});
