<!DOCTYPE html>

<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#16a34a">
  <meta name="description" content="EarnNest - Login and Register">
  <title>EarnNest - Login & Register</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow-x: hidden;
      background: #0f172a;
      padding: 20px 0;
    }

    .bg-image {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      z-index: 1;
      filter: brightness(0.85);
    }

    .bg-overlay {
      position: fixed;
      inset: 0;
      background: linear-gradient(
        180deg,
        rgba(15, 23, 42, 0.4) 0%,
        rgba(15, 23, 42, 0.72) 100%
      );
      z-index: 2;
    }

    #dollarCanvas {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 3;
      pointer-events: none;
    }

    .auth-container {
      position: relative;
      z-index: 10;
      width: 100%;
      max-width: 440px;
      padding: 20px;
    }

    .auth-card {
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 20px;
      padding: 32px 30px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.5);
    }

    .brand-header {
      text-align: center;
      margin-bottom: 25px;
    }

    .brand-title {
      font-size: 29px;
      font-weight: 800;
      color: #1e3a8a;
      letter-spacing: -0.5px;
    }

    .brand-subtitle {
      font-size: 14px;
      color: #475569;
      margin-top: 5px;
      font-weight: 500;
    }

    .mode-title {
      text-align: center;
      color: #1e293b;
      font-size: 20px;
      margin-bottom: 18px;
    }

    .form-group {
      margin-bottom: 15px;
    }

    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .form-control {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      font-size: 15px;
      background: #ffffff;
      color: #111827;
      outline: none;
      transition: all 0.2s ease;
    }

    .form-control:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
    }

    .form-control.error {
      border-color: #dc2626;
    }

    .btn-submit {
      width: 100%;
      padding: 14px;
      background: #16a34a;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s ease;
      margin-top: 7px;
      box-shadow: 0 4px 12px rgba(22, 163, 74, 0.3);
    }

    .btn-submit:hover {
      background: #15803d;
    }

    .btn-submit:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .forgot-wrap {
      text-align: right;
      margin-top: 11px;
    }

    .forgot-btn {
      background: none;
      border: none;
      color: #2563eb;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .forgot-btn:hover {
      text-decoration: underline;
    }

    .auth-toggle {
      text-align: center;
      margin-top: 20px;
      font-size: 14px;
      color: #64748b;
    }

    .auth-toggle a {
      color: #2563eb;
      font-weight: 700;
      text-decoration: none;
    }

    .auth-toggle a:hover {
      text-decoration: underline;
    }

    .referral-info {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12px;
      margin-bottom: 15px;
      line-height: 1.4;
    }

    #message {
      display: none;
      padding: 11px 13px;
      border-radius: 9px;
      margin-bottom: 15px;
      font-size: 13px;
      line-height: 1.4;
      font-weight: 600;
    }

    #message.success {
      display: block;
      background: #dcfce7;
      color: #166534;
      border: 1px solid #86efac;
    }

    #message.error {
      display: block;
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }

    .loading-text {
      display: none;
      text-align: center;
      color: #64748b;
      font-size: 12px;
      margin-top: 10px;
    }

    @media (max-width: 480px) {
      body {
        padding: 10px 0;
        align-items: flex-start;
      }

      .auth-container {
        padding: 10px;
        margin-top: 10px;
      }

      .auth-card {
        padding: 25px 20px;
        border-radius: 16px;
      }

      .brand-title {
        font-size: 26px;
      }
    }
  </style>

</head>

<body>

<img
src="Gemini_Generated_Image_778bs6778bs6778b.jfif"
alt="Wheat Farm"
class="bg-image"

>

  <div class="bg-overlay"></div>

<canvas id="dollarCanvas"></canvas>

  <div class="auth-container">
    <div class="auth-card">

```
  <div class="brand-header">
    <div class="brand-title">🌱 EarnNest</div>
    <div class="brand-subtitle">Work Hard, Grow Balance</div>
  </div>

  <div class="mode-title" id="modeTitle">Login to your account</div>

  <div id="message"></div>

  <form id="authForm">

    <!-- NAME -->
    <div class="form-group" id="nameGroup" style="display:none;">
      <label for="name">Full Name</label>
      <input
        type="text"
        id="name"
        class="form-control"
        placeholder="Enter full name"
        autocomplete="name"
      >
    </div>

    <!-- USERNAME -->
    <div class="form-group" id="usernameGroup" style="display:none;">
      <label for="username">Username</label>
      <input
        type="text"
        id="username"
        class="form-control"
        placeholder="Choose a username"
        autocomplete="username"
      >
    </div>

    <!-- PHONE -->
    <div class="form-group" id="phoneGroup" style="display:none;">
      <label for="phone">Phone Number</label>
      <input
        type="tel"
        id="phone"
        class="form-control"
        placeholder="03XXXXXXXXX"
        autocomplete="tel"
      >
    </div>

    <!-- EMAIL -->
    <div class="form-group">
      <label for="email">Email Address</label>
      <input
        type="email"
        id="email"
        class="form-control"
        placeholder="user@earnnest.app"
        autocomplete="email"
        required
      >
    </div>

    <!-- PASSWORD -->
    <div class="form-group">
      <label for="password">Password</label>
      <input
        type="password"
        id="password"
        class="form-control"
        placeholder="Minimum 6 characters"
        autocomplete="current-password"
        required
      >
    </div>

    <!-- CONFIRM PASSWORD -->
    <div class="form-group" id="confirmPasswordGroup" style="display:none;">
      <label for="confirmPassword">Confirm Password</label>
      <input
        type="password"
        id="confirmPassword"
        class="form-control"
        placeholder="Re-enter password"
        autocomplete="new-password"
      >
    </div>

    <!-- REFERRAL -->
    <div id="referralGroup" style="display:none;">
      <div class="referral-info">
        🎁 Have a referral code? Enter it below. It is optional.
      </div>

      <div class="form-group">
        <label for="referralCode">Referral Code</label>
        <input
          type="text"
          id="referralCode"
          class="form-control"
          placeholder="Enter referral code (optional)"
          autocomplete="off"
        >
      </div>
    </div>

    <button
      type="submit"
      id="submitBtn"
      class="btn-submit"
    >
      Login
    </button>

    <div
      class="loading-text"
      id="loadingText"
    >
      Please wait...
    </div>

  </form>

  <div
    class="forgot-wrap"
    id="forgotWrap"
  >
    <button
      type="button"
      class="forgot-btn"
      onclick="forgotPassword()"
    >
      Forgot Password?
    </button>
  </div>

  <div class="auth-toggle">
    <span id="toggleText">Don't have an account?</span>
    <a
      href="#"
      id="toggleBtn"
      onclick="toggleAuthMode(event)"
    >
      Sign Up
    </a>
  </div>

</div>
```

  </div>

  <script>
    'use strict';

    /*
     * EarnNest API
     *
     * This automatically uses the current website's /api endpoint.
     *
     * Example:
     * https://your-site.vercel.app/api
     */
    const API_BASE = window.EARNNEST_API || '/api';

    let isSignUp = false;

    const form = document.getElementById('authForm');
    const messageBox = document.getElementById('message');
    const submitBtn = document.getElementById('submitBtn');
    const loadingText = document.getElementById('loadingText');

    function showMessage(message, type) {
      messageBox.textContent = message;
      messageBox.className = type || '';
      messageBox.style.display = 'block';
    }

    function clearMessage() {
      messageBox.textContent = '';
      messageBox.className = '';
      messageBox.style.display = 'none';
    }

    function setLoading(loading) {
      submitBtn.disabled = loading;
      loadingText.style.display = loading ? 'block' : 'none';

      if (loading) {
        submitBtn.textContent = isSignUp
          ? 'Creating Account...'
          : 'Logging in...';
      } else {
        submitBtn.textContent = isSignUp ? 'Create Account' : 'Login';
      }
    }

    function setRequired(id, required) {
      const input = document.getElementById(id);

      if (input) {
        input.required = required;
      }
    }

    function toggleAuthMode(e) {
      if (e) e.preventDefault();

      isSignUp = !isSignUp;

      clearMessage();

      document.getElementById('nameGroup').style.display =
        isSignUp ? 'block' : 'none';

      document.getElementById('usernameGroup').style.display =
        isSignUp ? 'block' : 'none';

      document.getElementById('phoneGroup').style.display =
        isSignUp ? 'block' : 'none';

      document.getElementById('confirmPasswordGroup').style.display =
        isSignUp ? 'block' : 'none';

      document.getElementById('referralGroup').style.display =
        isSignUp ? 'block' : 'none';

      document.getElementById('forgotWrap').style.display =
        isSignUp ? 'none' : 'block';

      document.getElementById('modeTitle').textContent =
        isSignUp
          ? 'Create your EarnNest account'
          : 'Login to your account';

      document.getElementById('toggleText').textContent =
        isSignUp
          ? 'Already have an account?'
          : "Don't have an account?";

      document.getElementById('toggleBtn').textContent =
        isSignUp ? 'Login' : 'Sign Up';

      setRequired('name', isSignUp);
      setRequired('username', isSignUp);
      setRequired('phone', isSignUp);
      setRequired('confirmPassword', isSignUp);

      submitBtn.textContent =
        isSignUp ? 'Create Account' : 'Login';

      document.getElementById('password').autocomplete =
        isSignUp ? 'new-password' : 'current-password';
    }

    async function handleAuthSubmit(e) {
      e.preventDefault();

      clearMessage();

      const emailValue =
        document.getElementById('email').value.trim();

      const passwordValue =
        document.getElementById('password').value;

      if (!emailValue || !passwordValue) {
        showMessage(
          'Please enter your email/username and password.',
          'error'
        );
        return;
      }

      if (isSignUp) {
        await registerUser();
      } else {
        await loginUser();
      }
    }

    async function registerUser() {
      const name =
        document.getElementById('name').value.trim();

      const username =
        document.getElementById('username').value.trim();

      const email =
        document.getElementById('email').value.trim();

      const phone =
        document.getElementById('phone').value.trim();

      const password =
        document.getElementById('password').value;

      const confirmPassword =
        document.getElementById('confirmPassword').value;

      const referralCode =
        document.getElementById('referralCode').value.trim();

      if (!name || !username || !email || !phone) {
        showMessage(
          'Please fill all required fields.',
          'error'
        );
        return;
      }

      if (password.length < 6) {
        showMessage(
          'Password must be at least 6 characters.',
          'error'
        );
        return;
      }

      if (password !== confirmPassword) {
        showMessage(
          'Passwords do not match.',
          'error'
        );
        return;
      }

      setLoading(true);

      try {
        const response = await fetch(API_BASE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'register',
            name: name,
            username: username,
            email: email,
            phone: phone,
            password: password,
            confirmPassword: confirmPassword,
            referralCode: referralCode
          })
        });

        const data = await readApiResponse(response);

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
            data.error ||
            'Registration failed'
          );
        }

        /*
         * Registration was successful.
         *
         * Save user information locally so dashboard
         * can immediately identify the logged-in user.
         */
        if (data.user) {
          localStorage.setItem(
            'earnnest_user',
            JSON.stringify(data.user)
          );
        }

        /*
         * Registration API currently does not return a token.
         * Therefore automatically log the user in after
         * successful registration.
         */
        showMessage(
          'Account created successfully! Logging you in...',
          'success'
        );

        setTimeout(async () => {
          try {
            await loginAfterRegistration(
              email,
              password
            );
          } catch (error) {
            showMessage(
              'Account created, but automatic login failed. Please login manually.',
              'error'
            );

            setLoading(false);
            toggleToLogin();
          }
        }, 700);

      } catch (error) {
        console.error('Registration error:', error);

        showMessage(
          error.message ||
          'Registration failed. Please try again.',
          'error'
        );

        setLoading(false);
      }
    }

    async function loginAfterRegistration(
      emailValue,
      passwordValue
    ) {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          login: emailValue,
          email: emailValue,
          password: passwordValue
        })
      });

      const data = await readApiResponse(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          data.error ||
          'Login failed'
        );
      }

      saveLoginSession(data);

      window.location.href = '/dashboard.html';
    }

    async function loginUser() {
      const loginValue =
        document.getElementById('email').value.trim();

      const passwordValue =
        document.getElementById('password').value;

      setLoading(true);

      try {
        const response = await fetch(API_BASE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            login: loginValue,
            email: loginValue,
            username: loginValue,
            password: passwordValue
          })
        });

        const data = await readApiResponse(response);

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
            data.error ||
            'Login failed'
          );
        }

        saveLoginSession(data);

        showMessage(
          'Login successful! Opening dashboard...',
          'success'
        );

        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 500);

      } catch (error) {
        console.error('Login error:', error);

        showMessage(
          error.message ||
          'Login failed. Please try again.',
          'error'
        );

        setLoading(false);
      }
    }

    function saveLoginSession(data) {
      if (data.token) {
        localStorage.setItem(
          'earnnest_token',
          data.token
        );
      }

      if (data.user) {
        localStorage.setItem(
          'earnnest_user',
          JSON.stringify(data.user)
        );
      }
    }

    async function readApiResponse(response) {
      const text = await response.text();

      if (!text) {
        return {};
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        console.error(
          'Invalid API response:',
          text
        );

        throw new Error(
          'Server returned an invalid response.'
        );
      }
    }

    function toggleToLogin() {
      if (isSignUp) {
        toggleAuthMode();
      }
    }

    function forgotPassword() {
      showMessage(
        'Password reset is not connected yet. Please contact EarnNest support.',
        'error'
      );
    }

    /*
     * If an old login session exists, don't force
     * the user to login again unnecessarily.
     */
    function checkExistingSession() {
      const token =
        localStorage.getItem('earnnest_token');

      const user =
        localStorage.getItem('earnnest_user');

      if (token && user) {
        try {
          JSON.parse(user);
        } catch {
          localStorage.removeItem('earnnest_user');
          localStorage.removeItem('earnnest_token');
        }
      }
    }

    checkExistingSession();


    /* ==========================================
       Falling Dollar Animation
       ========================================== */

    const canvas =
      document.getElementById('dollarCanvas');

    const ctx =
      canvas.getContext('2d');

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    window.addEventListener(
      'resize',
      resizeCanvas
    );

    resizeCanvas();

    const dollars = Array.from(
      { length: 35 },
      () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: 1.5 + Math.random() * 2.5,
        size: 20 + Math.random() * 12,
        opacity: 0.6 + Math.random() * 0.4
      })
    );

    function animateDollars() {
      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      dollars.forEach(d => {
        ctx.font =
          `bold ${d.size}px Arial`;

        ctx.fillStyle =
          `rgba(34, 197, 94, ${d.opacity})`;

        ctx.fillText(
          '💵 $',
          d.x,
          d.y
        );

        d.y += d.speed;

        if (d.y > canvas.height + 30) {
          d.y = -30;
          d.x = Math.random() * canvas.width;
        }
      });

      requestAnimationFrame(
        animateDollars
      );
    }

    animateDollars();


    /*
     * Allow Enter key to submit normally.
     */
    form.addEventListener(
      'submit',
      handleAuthSubmit
    );

  </script>

</body>
</html>
