/* ==========================================================
   CACSF ALUMNI FELLOWSHIP — ADMIN DASHBOARD
   Existing dashboard + Super Admin Management + Monitoring
   Requires Supabase JS v2, SheetJS (XLSX) and JSZip.
   ========================================================== */

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const has = id => Boolean($(id));

  const cfg =
    window.CACSF_SUPABASE_URL &&
    window.CACSF_SUPABASE_ANON_KEY &&
    window.supabase;

  const client = cfg
    ? window.supabase.createClient(
        window.CACSF_SUPABASE_URL,
        window.CACSF_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      )
    : null;

  const BUCKET = window.CACSF_STORAGE_BUCKET || 'cacsf-media';

  let alumni = [];
  // IDs selected for optional bulk deletion in the Alumni Directorate.
  const selectedAlumniIds = new Set();
  let media = [];
  let projects = [];
  let messages = [];

  let selectedMonth = null;
  let mediaFilter = 'all';
  let currentUser = null;
  let monitoringActivity = [];
  let monitoringAdmins = [];
  let monitoringLoginHistory = [];
  const selectedLoginIds = new Set();

  let isAdmin = false;
  let isSuperAdmin = false;
  let heartbeatTimer = null;

  /* ==========================================================
     GENERAL HELPERS
     ========================================================== */

  const esc = value =>
    String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));

  const say = (id, msg, kind = '') => {
    const el = $(id);
    if (!el) return;

    el.textContent = msg;
    el.className = el.className
      .replace(/\b(error|success)\b/g, '')
      .trim();

    if (kind) el.classList.add(kind);
  };

  const fmtDate = value =>
    value
      ? new Date(value).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
      : '—';

  const fmtDateTime = value =>
    value ? new Date(value).toLocaleString() : '—';

  const fullName = r =>
    [r.alias, r.first_name, r.surname]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Unnamed alumnus';

  const monthKey = value => {
    const d = value ? new Date(value) : null;

    return d && !Number.isNaN(d.getTime())
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : 'Unknown';
  };

  const monthName = key => {
    const [y, m] = key.split('-').map(Number);

    return new Date(y, m - 1, 1).toLocaleDateString(
      undefined,
      { month: 'long', year: 'numeric' }
    );
  };

  const dateSort = (a, b) =>
    new Date(b.created_at || 0) -
    new Date(a.created_at || 0);

  const publicUrl = path => {
    if (!path || !client) return '';

    return client.storage
      .from(BUCKET)
      .getPublicUrl(path).data.publicUrl;
  };

  const storageRemove = async path => {
    if (!path || !client) return;

    const { error } = await client.storage
      .from(BUCKET)
      .remove([path]);

    if (error) {
      console.warn('Storage cleanup failed:', error.message);
    }
  };

  const setBusy = (button, busy, label) => {
    if (!button) return;

    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = label || 'Working…';
    } else {
      button.disabled = false;

      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
      }
    }
  };

  /*
   * Retrieve a valid access token for protected Edge Functions.
   * Refresh the session if the access token is missing.
   */

  async function getCurrentAccessToken() {
    const {
      data: sessionData,
      error: sessionError
    } = await client.auth.getSession();

    if (sessionError) {
      throw new Error(
        `Could not retrieve your login session: ${sessionError.message}`
      );
    }

    let session = sessionData?.session;

    if (!session?.access_token) {
      const refreshResult =
        await client.auth.refreshSession();

      if (refreshResult.error) {
        throw new Error(
          `Your login session has expired. Please log out and log in again. ${refreshResult.error.message}`
        );
      }

      session = refreshResult.data?.session;
    }

    if (!session?.access_token) {
      throw new Error(
        'No valid access token was found. Please log out and log in again.'
      );
    }

    return session.access_token;
  }

  /*
   * Extract the actual response returned by an Edge Function.
   */

  async function getFunctionErrorMessage(error) {
    let message = error?.message || 'Unknown error';

    const context = error?.context;

    if (context) {
      try {
        if (typeof context.json === 'function') {
          const body = await context.clone().json();

          if (body?.error) return body.error;
          if (body?.message) return body.message;
          if (body?.msg) return body.msg;

          return JSON.stringify(body);
        }

        if (typeof context.text === 'function') {
          const bodyText = await context.clone().text();

          if (bodyText) {
            try {
              const body = JSON.parse(bodyText);

              return (
                body.error ||
                body.message ||
                body.msg ||
                bodyText
              );
            } catch {
              return bodyText;
            }
          }
        }
      } catch (readError) {
        console.warn(
          'Could not read Edge Function error response:',
          readError
        );
      }
    }

    return message;
  }

  // Best-effort audit logging.

  async function audit(
    eventType,
    entityType = null,
    entityId = null,
    details = {}
  ) {
    if (!client || !isAdmin) return;

    try {
      const { error } = await client.rpc(
        'log_cacsf_admin_activity',
        {
          p_event_type: eventType,
          p_entity_type: entityType,
          p_entity_id:
            entityId == null ? null : String(entityId),
          p_details: details
        }
      );

      if (error) {
        console.warn(
          'Audit logging failed:',
          error.message
        );
      }
    } catch (error) {
      console.warn('Audit logging failed:', error);
    }
  }

  /* ==========================================================
     THEME
     ========================================================== */

  const savedTheme = () =>
    localStorage.getItem('cacsf-admin-theme') || 'light';

  function applyTheme(theme) {
    document.body.dataset.adminTheme = theme;

    const label = theme === 'dark' ? '☀' : '☾';

    if (has('theme-toggle')) {
      $('theme-toggle').textContent = label;
    }

    if (has('settings-theme')) {
      $('settings-theme').textContent =
        theme === 'dark'
          ? 'Switch to light appearance'
          : 'Switch to dark appearance';
    }

    if (has('login-theme')) {
      $('login-theme').textContent = label;
    }

    localStorage.setItem('cacsf-admin-theme', theme);
  }

  function toggleTheme() {
    applyTheme(
      document.body.dataset.adminTheme === 'dark'
        ? 'light'
        : 'dark'
    );
  }

  applyTheme(savedTheme());

  [
    'theme-toggle',
    'settings-theme',
    'login-theme'
  ].forEach(id => {
    $(id)?.addEventListener('click', toggleTheme);
  });

  /* ==========================================================
     NAVIGATION
     ========================================================== */

  const routeLabels = {
    overview: 'Overview',
    directory: 'Alumni directory',
    monthly: 'Monthly registrations',
    birthdays: 'Birthday directory',
    media: 'Reunion media',
    projects: 'Project gallery',
    messages: 'Contact messages',
    settings: 'Admin settings',
    'admin-management': 'Admin management',
    monitoring: 'Monitoring & security'
  };

  function setSuperAdminNavigation(allowed) {
    document
      .querySelectorAll(
        '[data-route="admin-management"], [data-route="monitoring"]'
      )
      .forEach(link => {
        link.hidden = !allowed;
        link.style.display = allowed ? '' : 'none';
      });
  }

  function navigate(route) {
    if (!routeLabels[route]) {
      route = 'overview';
    }

    if (
      (route === 'admin-management' || route === 'monitoring') &&
      !isSuperAdmin
    ) {
      route = 'overview';
    }

    document
      .querySelectorAll('.page[id^="page-"]')
      .forEach(page => {
        page.hidden = page.id !== `page-${route}`;
      });

    document
      .querySelectorAll('[data-route]')
      .forEach(link => {
        link.classList.toggle(
          'active',
          link.dataset.route === route
        );
      });

    if (has('crumb-label')) {
      $('crumb-label').textContent = routeLabels[route];
    }

    if (location.hash !== `#${route}`) {
      history.replaceState(null, '', `#${route}`);
    }

    $('sidebar')?.classList.remove('open');
    $('mobile-shade')?.classList.remove('show');

    if (route === 'admin-management' && isSuperAdmin) {
      loadAdmins();
    }

    if (route === 'monitoring' && isSuperAdmin) {
      loadMonitoring();
    }
  }

  document
    .querySelectorAll('[data-route]')
    .forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        navigate(link.dataset.route);
      });
    });

  window.addEventListener('hashchange', () => {
    navigate(location.hash.slice(1));
  });

  if (has('menu-toggle')) {
    $('menu-toggle').addEventListener('click', () => {
      $('sidebar')?.classList.toggle('open');
      $('mobile-shade')?.classList.toggle('show');
    });
  }

  if (has('mobile-shade')) {
    $('mobile-shade').addEventListener('click', () => {
      $('sidebar')?.classList.remove('open');
      $('mobile-shade')?.classList.remove('show');
    });
  }

  if (has('today-label')) {
    $('today-label').textContent =
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
  }

  /* ==========================================================
     LOGIN PAGE
     ========================================================== */

  const loginForm = $('admin-login');

  if (loginForm) {
    if (has('login-theme')) {
      applyTheme(savedTheme());
    }

    $('show-password')?.addEventListener('click', () => {
      const field = $('login-password');
      if (!field) return;

      const show = field.type === 'password';

      field.type = show ? 'text' : 'password';
      $('show-password').textContent = show ? 'Hide' : 'Show';
    });

    $('forgot-password')?.addEventListener('click', async () => {
      const email =
        loginForm.elements.email?.value?.trim();

      if (!email) {
        say(
          'login-status',
          'Enter your administrator email address first.',
          'error'
        );

        loginForm.elements.email?.focus();
        return;
      }

      if (!client) {
        say(
          'login-status',
          'Supabase configuration is missing. Check assets/js/config.js.',
          'error'
        );
        return;
      }

      say('login-status', 'Sending password reset email…');

      const redirectTo =
        `${location.origin}${location.pathname.replace(/[^/]*$/, 'login.html')}`;

      const { error } =
        await client.auth.resetPasswordForEmail(
          email,
          { redirectTo }
        );

      say(
        'login-status',
        error
          ? `Password reset failed: ${error.message}`
          : 'If this email belongs to an administrator, a password reset link has been sent.',
        error ? 'error' : 'success'
      );
    });

    loginForm.addEventListener('submit', async e => {
      e.preventDefault();

      if (!client) {
        say(
          'login-status',
          'Supabase configuration is missing. Check assets/js/config.js.',
          'error'
        );
        return;
      }

      const button = $('login-submit');
      setBusy(button, true, 'Signing in…');

      const data = new FormData(loginForm);

      const { error } =
        await client.auth.signInWithPassword({
          email: String(data.get('email') || '').trim(),
          password: data.get('password')
        });

      setBusy(button, false);

      if (error) {
        say('login-status', error.message, 'error');
        return;
      }

      location.href = 'index.html';
    });
  }

  // Stop here on login page.
  if (!has('admin-user')) return;

  /* ==========================================================
     CONNECTION AND ROLE VERIFICATION
     ========================================================== */

  function setConnection(message, kind = '') {
    say('connection-status', message, kind);

    if (has('connection-short')) {
      $('connection-short').textContent =
        kind === 'success'
          ? 'Connected'
          : kind === 'error'
            ? 'Connection issue'
            : 'Checking connection';
    }

    const dot = document.querySelector('.connection');

    if (dot) {
      dot.classList.toggle('ok', kind === 'success');
    }
  }

  async function verifyRoles() {
    if (!client) {
      throw new Error(
        'Supabase configuration is missing. Check assets/js/config.js.'
      );
    }

    const [
      { data: adminData, error: adminError },
      { data: superData, error: superError }
    ] = await Promise.all([
      client.rpc('is_cacsf_admin'),
      client.rpc('is_cacsf_super_admin')
    ]);

    if (adminError) {
      throw new Error(
        `Administrator verification failed: ${adminError.message}`
      );
    }

    if (superError) {
      throw new Error(
        `Super Admin verification failed: ${superError.message}`
      );
    }

    isAdmin = adminData === true;
    isSuperAdmin = superData === true;

    if (!isAdmin) {
      throw new Error(
        'This account is not an active CACSF administrator.'
      );
    }

    setSuperAdminNavigation(isSuperAdmin);
  }

  /* ==========================================================
     ADMIN PRESENCE AND LOGIN HISTORY
     ========================================================== */

  async function startPresence() {
    if (!isAdmin) return;

    const sendHeartbeat = async () => {
      try {
        const { error } = await client.rpc(
          'heartbeat_cacsf_admin'
        );

        if (error) {
          console.warn(
            'Administrator heartbeat failed:',
            error.message
          );
        }
      } catch (error) {
        console.warn('Administrator heartbeat failed:', error);
      }
    };

    await sendHeartbeat();

    heartbeatTimer = window.setInterval(
      sendHeartbeat,
      30000
    );

    const sessionKey =
      `cacsf-admin-login-recorded-${currentUser.id}`;

    if (!sessionStorage.getItem(sessionKey)) {
      const { error } = await client.rpc(
        'record_cacsf_admin_session',
        { p_event_type: 'login' }
      );

      if (!error) {
        sessionStorage.setItem(sessionKey, '1');
      } else {
        console.warn(
          'Login event could not be recorded:',
          error.message
        );
      }
    }
  }

  async function signOut() {
    if (client && isAdmin) {
      try {
        await client.rpc(
          'record_cacsf_admin_session',
          { p_event_type: 'logout' }
        );
      } catch (error) {
        console.warn('Logout event could not be recorded:', error);
      }
    }

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    if (client) {
      await client.auth.signOut();
    }

    location.href = 'login.html';
  }

  $('logout')?.addEventListener('click', signOut);
  $('settings-logout')?.addEventListener('click', signOut);

  async function requireSession() {
    if (!client) {
      setConnection(
        'Supabase configuration is missing. Check assets/js/config.js.',
        'error'
      );
      return;
    }

    const { data, error } = await client.auth.getSession();

    if (error || !data?.session) {
      location.href = 'login.html';
      return;
    }

    currentUser = data.session.user;

    $('admin-user').textContent =
      currentUser.email || 'Administrator';

    if (has('settings-email')) {
      $('settings-email').textContent =
        currentUser.email || 'Administrator';
    }

    try {
      await verifyRoles();
      await startPresence();
      await loadAll();

      const initialRoute = location.hash.slice(1);

      navigate(
        routeLabels[initialRoute]
          ? initialRoute
          : 'overview'
      );
    } catch (error) {
      console.error(error);

      setConnection(error.message, 'error');

      alert(
        error.message +
        ' You will be returned to the login page.'
      );

      await client.auth.signOut();
      location.href = 'login.html';
    }
  }

  /* ==========================================================
     LOAD EXISTING DASHBOARD DATA
     ========================================================== */

  async function loadTable(table) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    return data || [];
  }

  async function loadAll() {
    if (!client) {
      setConnection(
        'Supabase configuration is missing. Check assets/js/config.js.',
        'error'
      );
      return;
    }

    setConnection('Loading live records from Supabase…');

    try {
      const results = await Promise.all([
        loadTable('alumni'),
        loadTable('media'),
        loadTable('project_gallery'),

        isSuperAdmin
          ? loadTable('messages')
          : Promise.resolve([])
      ]);

      alumni = results[0];
      media = results[1];
      projects = results[2];
      messages = results[3];

      renderAll();

      setConnection(
        `Connected · ${alumni.length} alumni · ${media.length} media · ${projects.length} projects · ${messages.length} messages`,
        'success'
      );
    } catch (error) {
      console.error(error);

      setConnection(
        `Could not load live data: ${error.message}. Check Supabase table names and Row Level Security policies.`,
        'error'
      );
    }
  }

  $('refresh-all')?.addEventListener('click', loadAll);

  /* ==========================================================
     SUPER ADMIN — ADMINISTRATOR MANAGEMENT
     ========================================================== */

  function adminRoleLabel(role) {
    return role === 'super_admin'
      ? 'Super Admin'
      : 'Administrator';
  }

  function getAdminStatus(admin) {
    if (
      ['pending', 'active', 'suspended'].includes(admin.status)
    ) {
      return admin.status;
    }

    return admin.is_active ? 'active' : 'suspended';
  }

  async function loadAdmins() {
    if (!isSuperAdmin) return;

    const table = $('admin-users-table');

    if (table) {
      table.innerHTML =
        '<tr><td colspan="5" class="empty-cell">Loading administrators…</td></tr>';
    }

    try {
      const { data, error } = await client
        .from('admin_users')
        .select(
          'user_id,email,role,is_active,status,invitation_accepted_at,created_at,updated_at'
        )
        .order('created_at', { ascending: true });

      if (error) throw error;

      const query = (
        $('admin-search')?.value || ''
      ).trim().toLowerCase();

      const rows = (data || []).filter(r =>
        [
          r.email,
          r.role,
          r.user_id,
          getAdminStatus(r)
        ].join(' ').toLowerCase().includes(query)
      );

      if (has('admin-account-count')) {
        $('admin-account-count').textContent =
          `${data.length} administrator account${data.length === 1 ? '' : 's'}`;
      }

      if (!table) return;

      table.innerHTML = rows.length
        ? rows.map(r => {
            const status = getAdminStatus(r);

            const statusClass =
              status === 'active'
                ? 'success'
                : status === 'pending'
                  ? 'warning'
                  : 'muted';

            const statusLabel =
              status === 'pending'
                ? 'Pending'
                : status === 'active'
                  ? 'Active'
                  : 'Suspended';

            const accepted =
              Boolean(r.invitation_accepted_at);

            let toggleLabel = 'Suspend';
            let toggleDisabled = '';

            if (status === 'suspended') {
              if (accepted) {
                toggleLabel = 'Reactivate';
              } else {
                toggleLabel = 'Awaiting acceptance';
                toggleDisabled = 'disabled';
              }
            }

            return `
              <tr>
                <td>${esc(r.email || r.user_id)}</td>

                <td>${esc(adminRoleLabel(r.role))}</td>

                <td>
                  <span class="status-pill ${statusClass}">
                    ${statusLabel}
                  </span>
                </td>

                <td>${esc(fmtDate(r.created_at))}</td>

                <td class="admin-row-actions">
                  <select
                    aria-label="Change administrator role"
                    data-admin-role="${esc(r.user_id)}"
                  >
                    <option value="admin" ${r.role === 'admin' ? 'selected' : ''}>
                      Administrator
                    </option>

                    <option value="super_admin" ${r.role === 'super_admin' ? 'selected' : ''}>
                      Super Admin
                    </option>
                  </select>

                  <button
                    type="button"
                    class="action-link"
                    data-admin-toggle="${esc(r.user_id)}"
                    data-status="${status}"
                    data-accepted="${accepted ? 'true' : 'false'}"
                    ${toggleDisabled}
                  >
                    ${toggleLabel}
                  </button>

                  <button
                    type="button"
                    class="action-link"
                    data-admin-remove="${esc(r.user_id)}"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            `;
          }).join('')
        : '<tr><td colspan="5" class="empty-cell">No administrator accounts match this search.</td></tr>';

    } catch (error) {
      console.error(error);

      if (table) {
        table.innerHTML = `
          <tr>
            <td colspan="5" class="empty-cell">
              Could not load administrators: ${esc(error.message)}
            </td>
          </tr>
        `;
      }
    }
  }

  $('refresh-admins')?.addEventListener(
    'click',
    loadAdmins
  );

  $('admin-search')?.addEventListener(
    'input',
    loadAdmins
  );

  /* ==========================================================
     SUPER ADMIN INVITATION
     ========================================================== */

  $('admin-invite-form')?.addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      if (!isSuperAdmin) {
        say(
          'admin-invite-status',
          'Only an active Super Admin can invite administrators.',
          'error'
        );
        return;
      }

      const form = e.currentTarget;

      const email = String(
        form.elements.email?.value || ''
      ).trim().toLowerCase();

      const role = String(
        form.elements.role?.value || 'admin'
      ).trim();

      const button =
        form.querySelector('[type="submit"]');

      if (!email) {
        say(
          'admin-invite-status',
          'Enter an email address.',
          'error'
        );
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        say(
          'admin-invite-status',
          'Enter a valid email address.',
          'error'
        );
        return;
      }

      if (!['admin', 'super_admin'].includes(role)) {
        say(
          'admin-invite-status',
          'Select a valid administrator role.',
          'error'
        );
        return;
      }

      setBusy(button, true, 'Checking account…');

      say(
        'admin-invite-status',
        'Checking your Super Admin session…'
      );

      try {
        const accessToken =
          await getCurrentAccessToken();

        const {
          data: stillSuperAdmin,
          error: roleCheckError
        } = await client.rpc('is_cacsf_super_admin');

        if (roleCheckError) {
          throw new Error(
            `Could not verify Super Admin permission: ${roleCheckError.message}`
          );
        }

        if (stillSuperAdmin !== true) {
          throw new Error(
            'Your account does not currently have active Super Admin permission.'
          );
        }

        async function sendInvitation(replaceExisting = false) {
          const { data, error } =
            await client.functions.invoke(
              'cacsf-admin-invite',
              {
                body: {
                  email,
                  role,
                  replace_existing: replaceExisting
                },
                headers: {
                  Authorization: `Bearer ${accessToken}`
                }
              }
            );

          if (error) {
            throw new Error(
              await getFunctionErrorMessage(error)
            );
          }

          if (data?.error && !data?.account_exists) {
            throw new Error(data.error);
          }

          return data;
        }

        say(
          'admin-invite-status',
          'Checking whether this email already has a Supabase account…'
        );

        let data = await sendInvitation(false);

        if (
          data?.account_exists === true ||
          data?.code === 'EXISTING_AUTH_ACCOUNT'
        ) {
          const accountStatus =
            data.account_confirmed
              ? 'Its email has already been confirmed.'
              : 'Its email has not yet been confirmed.';

          const confirmed = window.confirm(
            `An account already exists for ${email}.\n\n` +
            `${accountStatus}\n\n` +
            `If you continue:\n` +
            `1. The old Supabase Auth account will be permanently deleted.\n` +
            `2. Its old administrator record will be removed.\n` +
            `3. A fresh invitation will be sent to this email.\n\n` +
            `The person will need to accept the new invitation and establish their password again.\n\n` +
            `Do you want to permanently delete the old account and send a fresh invitation?`
          );

          if (!confirmed) {
            say(
              'admin-invite-status',
              'Invitation cancelled. The existing account has not been deleted.',
              'success'
            );
            return;
          }

          say(
            'admin-invite-status',
            'Deleting the old account and preparing a fresh invitation…'
          );

          data = await sendInvitation(true);
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        if (data?.success !== true) {
          throw new Error(
            data?.message ||
            'The invitation request did not return a success confirmation.'
          );
        }

        say(
          'admin-invite-status',
          data.message ||
            `Administrator invitation sent to ${email}.`,
          'success'
        );

        form.reset();

        await loadAdmins();

        await audit(
          data.old_account_deleted
            ? 'admin_account_replaced_and_invited'
            : 'admin_invited',
          'admin_users',
          null,
          {
            email,
            role,
            old_account_deleted:
              Boolean(data.old_account_deleted)
          }
        );

      } catch (error) {
        console.error(
          'Administrator invitation failed:',
          error
        );

        say(
          'admin-invite-status',
          `Invitation failed: ${error.message || 'Unknown error'}`,
          'error'
        );

      } finally {
        setBusy(button, false);
      }
    }
  );

  /* ==========================================================
     CHANGE ADMINISTRATOR ROLE
     ========================================================== */

  document.addEventListener('change', async e => {
    const select =
      e.target.closest('[data-admin-role]');

    if (!select || !isSuperAdmin) return;

    const userId = select.dataset.adminRole;
    const newRole = select.value;

    if (!confirm(
      `Change this administrator's role to ${adminRoleLabel(newRole)}?`
    )) {
      await loadAdmins();
      return;
    }

    select.disabled = true;

    try {
      const { error } = await client
        .from('admin_users')
        .update({
          role: newRole,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) throw error;

      await audit(
        'admin_role_changed',
        'admin_users',
        userId,
        { role: newRole }
      );

      await loadAdmins();

    } catch (error) {
      alert(
        `Could not change administrator role: ${error.message}`
      );

      await loadAdmins();
    }
  });

  /* ==========================================================
     SUSPEND, REACTIVATE OR REMOVE ADMINISTRATOR
     ========================================================== */

  document.addEventListener('click', async e => {
    const toggle =
      e.target.closest('[data-admin-toggle]');

    const remove =
      e.target.closest('[data-admin-remove]');

    if (!isSuperAdmin) return;

    if (toggle) {
      const userId = toggle.dataset.adminToggle;
      const currentStatus = toggle.dataset.status;

      const invitationAccepted =
        toggle.dataset.accepted === 'true';

      let nextStatus;
      let nextActive;

      if (currentStatus === 'suspended') {
        if (!invitationAccepted) {
          alert(
            'This administrator has not accepted the invitation yet. They must accept the invitation before you can reactivate the account.'
          );
          return;
        }

        nextStatus = 'active';
        nextActive = true;

      } else {
        nextStatus = 'suspended';
        nextActive = false;
      }

      const action =
        nextStatus === 'active' ? 'Reactivate' : 'Suspend';

      if (!confirm(
        `${action} this administrator?`
      )) {
        return;
      }

      setBusy(
        toggle,
        true,
        nextActive ? 'Activating…' : 'Suspending…'
      );

      try {
        const { error } = await client
          .from('admin_users')
          .update({
            status: nextStatus,
            is_active: nextActive,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);

        if (error) throw error;

        await audit(
          nextActive
            ? 'admin_reactivated'
            : 'admin_suspended',
          'admin_users',
          userId,
          {
            status: nextStatus,
            is_active: nextActive
          }
        );

        await loadAdmins();

      } catch (error) {
        alert(
          `Could not update administrator status: ${error.message}`
        );

        await loadAdmins();
      }
    }

    if (remove) {
      const userId = remove.dataset.adminRemove;

      if (!confirm(
        'PERMANENTLY DELETE THIS ADMINISTRATOR?\n\n' +
        'This will delete:\n' +
        '1. Their CACSF administrator record.\n' +
        '2. Their Supabase Authentication account.\n\n' +
        'They will no longer be able to sign in.\n' +
        'You can invite the same email again later.\n\n' +
        'This action cannot be undone.\n\n' +
        'Do you want to continue?'
      )) {
        return;
      }

      setBusy(remove, true, 'Removing…');

      try {
        const accessToken = await getCurrentAccessToken();

        const {
          data: stillSuperAdmin,
          error: roleCheckError
        } = await client.rpc('is_cacsf_super_admin');

        if (roleCheckError) {
          throw new Error(roleCheckError.message);
        }

        if (stillSuperAdmin !== true) {
          throw new Error(
            'Only an active Super Admin can permanently remove administrators.'
          );
        }

        const { data, error } =
          await client.functions.invoke(
            'cacsf-admin-remove',
            {
              body: {
                user_id: userId
              },
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }
          );

        if (error) {
          throw new Error(
            await getFunctionErrorMessage(error)
          );
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        if (data?.success !== true) {
          throw new Error(
            data?.message ||
            'The administrator could not be removed.'
          );
        }

        await audit(
          'admin_access_removed',
          'admin_users',
          userId,
          {
            email: data.email,
            auth_account_deleted: data.auth_account_deleted,
            admin_record_deleted: data.admin_record_deleted
          }
        );

        alert(
          data.message ||
          'Administrator successfully deleted.'
        );

        await loadAdmins();

      } catch (error) {
        console.error(
          'Administrator removal failed:',
          error
        );

        alert(
          `Could not remove administrator: ${error.message || 'Unknown error'}`
        );

        await loadAdmins();

      } finally {
        setBusy(remove, false);
      }
    }
  });

  /* ==========================================================
     SUPER ADMIN — MONITORING AND SECURITY
     ========================================================== */

  function presenceLabel(lastSeen) {
    if (!lastSeen) return 'No heartbeat recorded';

    const age =
      Date.now() - new Date(lastSeen).getTime();

    return age <= 5 * 60 * 1000
      ? 'Recently active'
      : 'Away';
  }

  const selectedActivityIds = new Set();

  /* ==========================================================
     SUPER ADMIN — LOGIN HISTORY MANAGEMENT
     ========================================================== */

  function ensureLoginHistoryControls() {
    if (!isSuperAdmin) return;

    const tableBody = $('admin-login-table');
    const table = tableBody?.closest('table');
    if (!table || $('login-history-controls')) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'login-history-controls';
    toolbar.className = 'activity-log-controls';
    toolbar.innerHTML = `
      <div class="activity-log-toolbar">
        <label>
          <input type="checkbox" id="select-visible-login">
          Select visible
        </label>
        <button type="button" class="button" id="delete-selected-login" disabled>
          Delete selected (<span id="selected-login-count">0</span>)
        </button>
        <button type="button" class="button button-danger" id="clear-all-login" disabled>
          Clear all login history
        </button>
      </div>
      <p id="login-clear-status" role="status" aria-live="polite"></p>
    `;
    table.parentElement.insertBefore(toolbar, table);

    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('[data-login-select-heading]')) {
      const heading = document.createElement('th');
      heading.textContent = 'Select';
      heading.dataset.loginSelectHeading = 'true';
      headerRow.insertBefore(heading, headerRow.firstElementChild);
    }

    tableBody.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-login-select]');
      if (!checkbox || !isSuperAdmin) return;
      const id = String(checkbox.dataset.loginSelect);
      if (checkbox.checked) selectedLoginIds.add(id);
      else selectedLoginIds.delete(id);
      renderLoginHistory();
    });

    $('select-visible-login')?.addEventListener('change', event => {
      if (!isSuperAdmin) return;
      monitoringLoginHistory.forEach(item => {
        const id = String(item.id);
        if (event.target.checked) selectedLoginIds.add(id);
        else selectedLoginIds.delete(id);
      });
      renderLoginHistory();
    });

    $('delete-selected-login')?.addEventListener('click', () => {
      clearLoginHistory([...selectedLoginIds], false);
    });

    $('clear-all-login')?.addEventListener('click', () => {
      clearLoginHistory([], true);
    });
  }

  function renderLoginHistory() {
    const table = $('admin-login-table');
    if (!table) return;

    const availableIds = new Set(
      monitoringLoginHistory.map(item => String(item.id))
    );
    [...selectedLoginIds].forEach(id => {
      if (!availableIds.has(id)) selectedLoginIds.delete(id);
    });

    table.innerHTML = monitoringLoginHistory.length
      ? monitoringLoginHistory.map(item => {
          const admin = monitoringAdmins.find(a => a.user_id === item.user_id);
          const id = String(item.id);
          return `
            <tr>
              <td>
                <input type="checkbox" data-login-select="${esc(id)}"
                  ${selectedLoginIds.has(id) ? 'checked' : ''}
                  aria-label="Select login history record">
              </td>
              <td>${esc(admin?.email || item.user_id || 'Unknown user')}</td>
              <td>${esc(item.event_type)}</td>
              <td>${esc(fmtDateTime(item.created_at))}</td>
            </tr>
          `;
        }).join('')
      : '<tr><td colspan="4" class="empty-cell">No login history recorded yet.</td></tr>';

    const selectAll = $('select-visible-login');
    if (selectAll) {
      selectAll.checked = monitoringLoginHistory.length > 0 &&
        monitoringLoginHistory.every(item => selectedLoginIds.has(String(item.id)));
      selectAll.indeterminate = monitoringLoginHistory.some(item =>
        selectedLoginIds.has(String(item.id))) && !selectAll.checked;
    }

    const selectedButton = $('delete-selected-login');
    if (selectedButton) selectedButton.disabled = selectedLoginIds.size === 0;
    const clearAllButton = $('clear-all-login');
    if (clearAllButton) clearAllButton.disabled = monitoringLoginHistory.length === 0;
    const count = $('selected-login-count');
    if (count) count.textContent = selectedLoginIds.size;
  }

  async function clearLoginHistory(ids, clearAll) {
    if (!isSuperAdmin) {
      say('login-clear-status', 'Only a Super Admin can delete login history.', 'error');
      return;
    }
    if (!clearAll && (!ids || ids.length === 0)) {
      say('login-clear-status', 'Select at least one login record.', 'error');
      return;
    }

    const confirmed = window.confirm(clearAll
      ? 'PERMANENTLY DELETE ALL LOGIN HISTORY? This cannot be undone.'
      : `PERMANENTLY DELETE ${ids.length} SELECTED LOGIN RECORD(S)? This cannot be undone.`);
    if (!confirmed) return;

    const button = clearAll ? $('clear-all-login') : $('delete-selected-login');
    setBusy(button, true, 'Deleting…');

    try {
      const { data: stillSuperAdmin, error: roleError } =
        await client.rpc('is_cacsf_super_admin');
      if (roleError) throw roleError;
      if (stillSuperAdmin !== true) {
        throw new Error('Your Super Admin permission is no longer active.');
      }

      const { data, error } = await client.rpc('clear_cacsf_admin_login_history', {
        p_login_ids: clearAll ? null : ids,
        p_clear_all: Boolean(clearAll)
      });
      if (error) throw error;

      selectedLoginIds.clear();
      say('login-clear-status',
        `${Number(data || 0)} login history record(s) deleted successfully.`,
        'success');
      await loadMonitoring();
    } catch (error) {
      console.error('Login history deletion failed:', error);
      say('login-clear-status', error.message || 'Login history could not be deleted.', 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function isProtectedAuditEvent(eventType) {
    return /admin_(invited|suspended|reactivated|role_changed|access_removed)|admin_login|admin_logout|login|logout|security|activity_logs_cleared/i.test(String(eventType || ''));
  }

  function renderActivityLog() {
    const adminFilter = $('activity-admin-filter')?.value || '';
    const typeFilter = $('activity-type-filter')?.value || '';
    const fromValue = $('activity-from-filter')?.value || '';
    const toValue = $('activity-to-filter')?.value || '';
    const from = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
    const to = toValue ? new Date(`${toValue}T23:59:59.999`) : null;

    const rows = monitoringActivity.filter(item => {
      const created = new Date(item.created_at);
      return (!adminFilter || item.actor_id === adminFilter) &&
        (!typeFilter || item.event_type === typeFilter) &&
        (!from || created >= from) && (!to || created <= to);
    });

    const table = $('admin-activity-table');
    if (!table) return;
    table.innerHTML = rows.length ? rows.map(item => {
      const admin = monitoringAdmins.find(a => a.user_id === item.actor_id);
      const protectedEvent = isProtectedAuditEvent(item.event_type);
      const details = item.details && typeof item.details === 'object'
        ? JSON.stringify(item.details) : '';
      const checked = selectedActivityIds.has(String(item.id));
      return `
        <tr class="${protectedEvent ? 'security-event activity-protected' : ''}">
          <td>${protectedEvent ? '<span title="Protected security audit record">🔒</span>' :
            `<input type="checkbox" data-activity-select="${esc(item.id)}" ${checked ? 'checked' : ''} aria-label="Select activity record">`}</td>
          <td>${esc(admin?.email || item.actor_id || 'System / public action')}</td>
          <td>${esc(item.event_type)}</td>
          <td>${esc([item.entity_type, item.entity_id].filter(Boolean).join(' · ') || '—')}<small>${esc(details)}</small></td>
          <td>${esc(fmtDateTime(item.created_at))}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-cell">No activity matches these filters.</td></tr>';

    const selectable = rows.filter(item => !isProtectedAuditEvent(item.event_type));
    const selectAll = $('select-visible-activity');
    if (selectAll) {
      selectAll.checked = selectable.length > 0 && selectable.every(x => selectedActivityIds.has(String(x.id)));
      selectAll.indeterminate = selectable.some(x => selectedActivityIds.has(String(x.id))) && !selectAll.checked;
    }
    const selectedVisible = selectable.filter(x => selectedActivityIds.has(String(x.id))).length;
    if ($('clear-selected-activity')) $('clear-selected-activity').disabled = selectedVisible === 0;
    if ($('clear-all-activity')) $('clear-all-activity').disabled = monitoringActivity.every(x => isProtectedAuditEvent(x.event_type));
  }

  async function clearActivityLogs(ids, clearAll) {
    if (!isSuperAdmin) {
      say('activity-clear-status', 'Only a Super Admin can clear activity logs.', 'error');
      return;
    }
    const prompt = clearAll
      ? 'Clear all routine administrator activity logs? Protected login and security audit records will be retained.'
      : `Clear ${ids.length} selected routine activity record(s)? Protected login and security audit records cannot be deleted.`;
    if (!window.confirm(prompt)) return;

    const button = clearAll ? $('clear-all-activity') : $('clear-selected-activity');
    setBusy(button, true, 'Clearing…');
    try {
      const { data, error } = await client.rpc('clear_cacsf_admin_activity', {
        p_activity_ids: clearAll ? null : ids,
        p_clear_all: Boolean(clearAll)
      });
      if (error) throw error;
      selectedActivityIds.clear();
      say('activity-clear-status',
        `${Number(data || 0)} routine activity record(s) cleared. Protected security records were retained.`,
        'success');
      await loadMonitoring();
    } catch (error) {
      console.error('Activity log clearing failed:', error);
      say('activity-clear-status', error.message || 'Activity logs could not be cleared.', 'error');
    } finally {
      setBusy(button, false);
      if (button) button.textContent = clearAll ? 'Clear all routine activity' : 'Clear selected';
    }
  }

  $('admin-activity-table')?.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-activity-select]');
    if (!checkbox || !isSuperAdmin) return;
    const id = String(checkbox.dataset.activitySelect);
    if (checkbox.checked) selectedActivityIds.add(id);
    else selectedActivityIds.delete(id);
    renderActivityLog();
  });

  $('select-visible-activity')?.addEventListener('change', event => {
    if (!isSuperAdmin) return;
    const adminFilter = $('activity-admin-filter')?.value || '';
    const typeFilter = $('activity-type-filter')?.value || '';
    const fromValue = $('activity-from-filter')?.value || '';
    const toValue = $('activity-to-filter')?.value || '';
    const from = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
    const to = toValue ? new Date(`${toValue}T23:59:59.999`) : null;
    monitoringActivity.filter(item => {
      const d = new Date(item.created_at);
      return !isProtectedAuditEvent(item.event_type) &&
        (!adminFilter || item.actor_id === adminFilter) &&
        (!typeFilter || item.event_type === typeFilter) &&
        (!from || d >= from) && (!to || d <= to);
    }).forEach(item => {
      const id = String(item.id);
      if (event.target.checked) selectedActivityIds.add(id);
      else selectedActivityIds.delete(id);
    });
    renderActivityLog();
  });

  ['activity-admin-filter','activity-type-filter','activity-from-filter','activity-to-filter']
    .forEach(id => $(id)?.addEventListener('change', renderActivityLog));

  $('activity-filter-reset')?.addEventListener('click', () => {
    ['activity-admin-filter','activity-type-filter','activity-from-filter','activity-to-filter']
      .forEach(id => { if ($(id)) $(id).value = ''; });
    renderActivityLog();
  });
  $('clear-selected-activity')?.addEventListener('click', () => {
    const ids = [...selectedActivityIds];
    clearActivityLogs(ids, false);
  });
  $('clear-all-activity')?.addEventListener('click', () => clearActivityLogs([], true));

  async function loadMonitoring() {
    if (!isSuperAdmin) return;

    const tableIds = [
      'admin-presence-table',
      'admin-login-table',
      'admin-activity-table'
    ];

    tableIds.forEach(id => {
      if (has(id)) {
        $(id).innerHTML =
          '<tr><td colspan="5" class="empty-cell">Loading…</td></tr>';
      }
    });

    try {
      const [
        adminsRes,
        presenceRes,
        loginRes,
        activityRes
      ] = await Promise.all([
        client
          .from('admin_users')
          .select(
            'user_id,email,role,is_active,status,invitation_accepted_at'
          ),

        client
          .from('admin_presence')
          .select('user_id,last_seen_at')
          .order('last_seen_at', { ascending: false })
          .limit(100),

        client
          .from('admin_login_history')
          .select('id,user_id,event_type,created_at')
          .order('created_at', { ascending: false })
          .limit(100),

        client
          .from('admin_activity')
          .select(
            'id,actor_id,event_type,entity_type,entity_id,details,created_at'
          )
          .order('created_at', { ascending: false })
          .limit(150)
      ]);

      for (const result of [
        adminsRes,
        presenceRes,
        loginRes,
        activityRes
      ]) {
        if (result.error) throw result.error;
      }

      const admins = adminsRes.data || [];

      const byId = new Map(
        admins.map(a => [a.user_id, a])
      );

      const presence = presenceRes.data || [];
      const logins = loginRes.data || [];
      const activity = activityRes.data || [];
      monitoringLoginHistory = logins;
      monitoringActivity = activity;
      monitoringAdmins = admins;
      ensureLoginHistoryControls();

      const adminSelect = $('activity-admin-filter');
      if (adminSelect) {
        const current = adminSelect.value;
        adminSelect.innerHTML = '<option value="">All administrators</option>' +
          admins.map(a => `<option value="${esc(a.user_id)}">${esc(a.email || a.user_id)}</option>`).join('');
        adminSelect.value = current;
      }
      const typeSelect = $('activity-type-filter');
      if (typeSelect) {
        const current = typeSelect.value;
        const types = [...new Set(activity.map(x => x.event_type).filter(Boolean))].sort();
        typeSelect.innerHTML = '<option value="">All activity types</option>' +
          types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
        typeSelect.value = current;
      }

      const activeCount =
        admins.filter(a =>
          getAdminStatus(a) === 'active' &&
          a.is_active === true
        ).length;

      const recentCount =
        presence.filter(p => {
          const admin = byId.get(p.user_id);

          return (
            admin &&
            getAdminStatus(admin) === 'active' &&
            admin.is_active === true &&
            Date.now() -
              new Date(p.last_seen_at).getTime()
              <= 5 * 60 * 1000
          );
        }).length;

      if (has('monitor-admin-count')) {
        $('monitor-admin-count').textContent =
          activeCount;
      }

      if (has('monitor-online-count')) {
        $('monitor-online-count').textContent =
          recentCount;
      }

      if (has('monitor-login-count')) {
        $('monitor-login-count').textContent =
          logins.filter(x => x.event_type === 'login').length;
      }

      if (has('monitor-activity-count')) {
        $('monitor-activity-count').textContent =
          activity.length;
      }

      if (has('admin-presence-table')) {
        $('admin-presence-table').innerHTML =
          presence.length
            ? presence.map(p => {
                const a = byId.get(p.user_id);

                return `
                  <tr>
                    <td>${esc(a?.email || p.user_id)}</td>
                    <td>${esc(a ? adminRoleLabel(a.role) : 'Former / unavailable admin')}</td>
                    <td>${esc(presenceLabel(p.last_seen_at))}</td>
                    <td>${esc(fmtDateTime(p.last_seen_at))}</td>
                  </tr>
                `;
              }).join('')
            : `
              <tr>
                <td colspan="4" class="empty-cell">
                  No administrator heartbeat records yet.
                </td>
              </tr>
            `;
      }

      if (has('admin-login-table')) {
        renderLoginHistory();
      }

      renderActivityLog();

    } catch (error) {
      console.error('Monitoring load failed:', error);

      tableIds.forEach(id => {
        if (has(id)) {
          $(id).innerHTML = `
            <tr>
              <td colspan="5" class="empty-cell">
                Could not load monitoring data: ${esc(error.message)}
              </td>
            </tr>
          `;
        }
      });
    }
  }

  $('refresh-monitoring')?.addEventListener(
    'click',
    loadMonitoring
  );

  /* ==========================================================
     OVERVIEW
     ========================================================== */

  function renderOverview() {
    $('alumni-count').textContent = alumni.length;
    $('media-count').textContent = media.length;
    $('project-count').textContent = projects.length;
    $('message-count').textContent = messages.length;

    const recent = [...alumni]
      .sort(dateSort)
      .slice(0, 8);

    $('recent-table').innerHTML = recent.length
      ? recent.map(r => `
          <tr>
            <td>${esc(fullName(r))}</td>
            <td>${esc(r.email || '—')}</td>
            <td>${esc(r.graduation_year || '—')}</td>
            <td>${esc(fmtDate(r.created_at))}</td>
          </tr>
        `).join('')
      : `
          <tr>
            <td colspan="4" class="empty-cell">
              No alumni registrations found.
            </td>
          </tr>
        `;

    const counts = {};

    alumni.forEach(r => {
      const key = monthKey(r.created_at);

      if (key !== 'Unknown') {
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    const keys = Object.keys(counts)
      .sort()
      .reverse()
      .slice(0, 8);

    $('overview-months').innerHTML = keys.length
      ? keys.map(k => `
          <button
            class="mini-month"
            type="button"
            data-overview-month="${k}"
          >
            <span>${esc(monthName(k))}</span>
            <b>${counts[k]}</b>
            <span>registrations</span>
          </button>
        `).join('')
      : '<div class="empty-cell">No dated registrations yet.</div>';

    document
      .querySelectorAll('[data-overview-month]')
      .forEach(btn => {
        btn.addEventListener('click', () => {
          navigate('monthly');
          selectMonth(btn.dataset.overviewMonth);
        });
      });
  }

  /* ==========================================================
     ALUMNI DIRECTORY
     ========================================================== */

  function renderDirectory() {
    const q = (
      $('alumni-search')?.value || ''
    ).trim().toLowerCase();

    const rows = alumni.filter(r =>
      [
        fullName(r),
        r.email,
        r.phone,
        r.graduation_year
      ].join(' ').toLowerCase().includes(q)
    );

    const availableIds = new Set(alumni.map(r => String(r.id)));
    [...selectedAlumniIds].forEach(id => {
      if (!availableIds.has(String(id))) selectedAlumniIds.delete(id);
    });

    $('directory-count').textContent =
      `${rows.length} of ${alumni.length} alumni`;

    const selectAll = $('select-visible-alumni');
    if (selectAll) {
      selectAll.hidden = !isSuperAdmin;
      selectAll.checked = rows.length > 0 &&
        rows.every(r => selectedAlumniIds.has(String(r.id)));
      selectAll.indeterminate = rows.some(r =>
        selectedAlumniIds.has(String(r.id))
      ) && !selectAll.checked;
    }

    const bulkButton = $('delete-selected-alumni');
    if (bulkButton) {
      bulkButton.hidden = !isSuperAdmin;
      bulkButton.disabled = selectedAlumniIds.size === 0;
    }
    const selectedCount = $('selected-alumni-count');
    if (selectedCount) selectedCount.textContent = selectedAlumniIds.size;

    $('alumni-table').innerHTML = rows.length
      ? rows.map(r => `
          <tr>
            <td class="bulk-select-cell">
              ${isSuperAdmin ? `
                <input
                  type="checkbox"
                  data-select-alumnus="${esc(r.id)}"
                  aria-label="Select ${esc(fullName(r))}"
                  ${selectedAlumniIds.has(String(r.id)) ? 'checked' : ''}
                >
              ` : ''}
            </td>
            <td>${esc(fullName(r))}</td>
            <td>${esc(r.email || '—')}</td>
            <td>${esc(r.phone || '—')}</td>
            <td>${esc(r.graduation_year || '—')}</td>
            <td>${esc(
              [r.birth_month, r.birth_day]
                .filter(Boolean).join(' ') || '—'
            )}</td>
            <td>${esc(fmtDate(r.created_at))}</td>
            <td>
              <button
                class="action-link"
                type="button"
                data-view-alumnus="${esc(r.id)}"
              >View</button>

              ${isSuperAdmin ? `
                <button
                  class="action-link"
                  type="button"
                  data-edit-alumnus="${esc(r.id)}"
                >Edit</button>

                <button
                  class="action-link"
                  type="button"
                  data-delete-alumnus="${esc(r.id)}"
                >Delete</button>
              ` : ''}
            </td>
          </tr>
        `).join('')
      : `
          <tr>
            <td colspan="8" class="empty-cell">
              No matching alumni records.
            </td>
          </tr>
        `;
  }

  async function deleteSelectedAlumni(button) {
    if (!isSuperAdmin) {
      alert('Only a Super Admin can delete alumni records.');
      return;
    }

    const selectedRecords = alumni.filter(r =>
      selectedAlumniIds.has(String(r.id))
    );

    if (!selectedRecords.length) {
      alert('Select at least one alumni record first.');
      return;
    }

    const names = selectedRecords
      .slice(0, 8)
      .map(r => `• ${fullName(r)}`)
      .join('\n');
    const extra = selectedRecords.length > 8
      ? `\n…and ${selectedRecords.length - 8} more`
      : '';

    const confirmed = window.confirm(
      `PERMANENTLY DELETE ${selectedRecords.length} ALUMNI RECORD(S)?\n\n` +
      `${names}${extra}\n\n` +
      `Each selected registration record will be permanently deleted. ` +
      `Its profile photograph will also be removed from CACSF storage, if one exists.\n\n` +
      `This action cannot be undone.\n\nDo you want to continue?`
    );

    if (!confirmed) return;

    setBusy(button, true, 'Deleting…');
    const deletedIds = [];
    const failures = [];

    try {
      const {
        data: stillSuperAdmin,
        error: roleError
      } = await client.rpc('is_cacsf_super_admin');

      if (roleError) {
        throw new Error(
          `Could not verify Super Admin permission: ${roleError.message}`
        );
      }
      if (stillSuperAdmin !== true) {
        throw new Error(
          'Your Super Admin permission is no longer active. No alumni records were deleted.'
        );
      }

      // Use the same per-record Supabase deletion and storage cleanup
      // approach as the existing individual-delete feature.
      for (const record of selectedRecords) {
        const id = record.id;
        try {
          const { data: deletedRows, error: deleteError } = await client
            .from('alumni')
            .delete()
            .eq('id', id)
            .select('id');

          if (deleteError) throw deleteError;
          if (!deletedRows || deletedRows.length === 0) {
            throw new Error('Supabase did not confirm deletion of this record.');
          }

          if (record.photo_path) {
            await storageRemove(record.photo_path);
          }

          await audit(
            'alumnus_record_deleted',
            'alumni',
            id,
            {
              name: fullName(record),
              email: record.email || null,
              photo_path: record.photo_path || null,
              bulk_delete: true
            }
          );

          deletedIds.push(String(id));
        } catch (error) {
          failures.push(`${fullName(record)}: ${error.message}`);
        }
      }

      if (deletedIds.length) {
        alumni = alumni.filter(
          r => !deletedIds.includes(String(r.id))
        );
      }
      selectedAlumniIds.clear();
      renderAll();

      if (failures.length) {
        alert(
          `${deletedIds.length} record(s) deleted successfully.\n` +
          `${failures.length} record(s) could not be deleted:\n\n` +
          failures.join('\n')
        );
      } else {
        alert(
          `${deletedIds.length} selected alumni record(s) have been successfully deleted.`
        );
      }
    } catch (error) {
      console.error('Bulk alumni deletion failed:', error);
      alert(`Could not complete bulk deletion:\n\n${error.message}`);
    } finally {
      setBusy(button, false);
      renderDirectory();
    }
  }

  function renderBirthdays() {
    const q = (
      $('birthday-search')?.value || ''
    ).trim().toLowerCase();

    const rows = alumni.filter(r =>
      r.birth_month &&
      r.birth_day &&
      [
        fullName(r),
        r.birth_month,
        r.birth_day,
        r.email,
        r.phone,
        r.graduation_year
      ].join(' ').toLowerCase().includes(q)
    );

    $('birthday-count').textContent =
      `${rows.length} birthday records`;

    $('birthday-table').innerHTML = rows.length
      ? [...rows]
          .sort((a, b) =>
            monthNumber(a.birth_month) -
              monthNumber(b.birth_month) ||
            Number(a.birth_day) - Number(b.birth_day)
          )
          .map(r => `
            <tr>
              <td>${esc(fullName(r))}</td>
              <td>${esc(r.birth_month)} ${esc(r.birth_day)}</td>
              <td>${esc(r.email || '—')}</td>
              <td>${esc(r.phone || '—')}</td>
              <td>${esc(r.graduation_year || '—')}</td>
            </tr>
          `).join('')
      : `
          <tr>
            <td colspan="5" class="empty-cell">
              No matching birthday details found.
            </td>
          </tr>
        `;
  }

  function monthNumber(name) {
    const d = new Date(`${name} 1, 2000`);

    return Number.isNaN(d.getTime())
      ? 13
      : d.getMonth() + 1;
  }

  $('alumni-search')?.addEventListener(
    'input',
    renderDirectory
  );

  $('select-visible-alumni')?.addEventListener('change', event => {
    if (!isSuperAdmin) return;
    const q = ($('alumni-search')?.value || '').trim().toLowerCase();
    const visibleRows = alumni.filter(r =>
      [
        fullName(r),
        r.email,
        r.phone,
        r.graduation_year
      ].join(' ').toLowerCase().includes(q)
    );

    visibleRows.forEach(record => {
      const id = String(record.id);
      if (event.target.checked) selectedAlumniIds.add(id);
      else selectedAlumniIds.delete(id);
    });
    renderDirectory();
  });

  $('alumni-table')?.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-select-alumnus]');
    if (!checkbox || !isSuperAdmin) return;

    const id = String(checkbox.dataset.selectAlumnus);
    if (checkbox.checked) selectedAlumniIds.add(id);
    else selectedAlumniIds.delete(id);
    renderDirectory();
  });

  $('delete-selected-alumni')?.addEventListener('click', event => {
    deleteSelectedAlumni(event.currentTarget);
  });

  $('birthday-search')?.addEventListener(
    'input',
    renderBirthdays
  );

  /* ==========================================================
     MONTHLY REGISTRATION REPORTS
     ========================================================== */

  const birthdayMonths = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  const birthdayMonthValue = value => {
    const found = birthdayMonths.find(m =>
      String(value || '').trim().toLowerCase() === m.toLowerCase()
    );
    return found || '';
  };

  function initMonthYear() {
    $('year-heading').textContent = '12 birthday-month folders';
  }

  function renderMonthGrid() {
    $('year-heading').textContent = '12 birthday-month folders';
    const counts = birthdayMonths.map(month =>
      alumni.filter(r => birthdayMonthValue(r.birth_month) === month).length
    );

    $('month-grid').innerHTML = counts.map((count, i) => {
      const month = birthdayMonths[i];
      return `
        <button type="button"
          class="month-card${selectedMonth === month ? ' selected' : ''}"
          data-month="${month}">
          <span>${month}</span>
          <b>${count}</b>
          <small>${count === 1 ? 'alumnus / alumna' : 'alumni'}</small>
        </button>
      `;
    }).join('');

    document.querySelectorAll('#month-grid [data-month]').forEach(btn => {
      btn.addEventListener('click', () => selectMonth(btn.dataset.month));
    });
  }

  function selectMonth(month) {
    selectedMonth = birthdayMonthValue(month);
    renderMonthGrid();

    const rows = alumni
      .filter(r => birthdayMonthValue(r.birth_month) === selectedMonth)
      .sort((a, b) =>
        Number(a.birth_day || 0) - Number(b.birth_day || 0) ||
        fullName(a).localeCompare(fullName(b))
      );

    $('month-detail-panel').hidden = false;
    $('month-detail-title').textContent = `${selectedMonth} Birthdays`;
    $('month-detail-note').textContent =
      `${rows.length} ${rows.length === 1 ? 'alumnus has' : 'alumni have'} a birthday in ${selectedMonth}. Registration dates remain recorded separately.`;

    const withPhotos = rows.filter(r => r.photo_path);
    $('month-metrics').innerHTML = `
      <div class="metric"><b>${rows.length}</b> Birthday records</div>
      <div class="metric"><b>${withPhotos.length}</b> Profile photos</div>
      <div class="metric"><b>${rows.length - withPhotos.length}</b> Without photos</div>
    `;

    $('month-table').innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td>${isSuperAdmin ? `<input type="checkbox" data-select-alumnus="${esc(r.id)}" ${selectedAlumniIds.has(String(r.id)) ? 'checked' : ''} aria-label="Select ${esc(fullName(r))}">` : ''}</td>
        <td>${esc(fullName(r))}<small>${esc(selectedMonth)} ${esc(r.birth_day || '')}</small></td>
        <td>${esc(r.email || '—')}</td>
        <td>${esc(r.phone || '—')}</td>
        <td>${esc(r.graduation_year || '—')}</td>
        <td>${esc(fmtDate(r.created_at))}</td>
        <td>
          <button class="action-link" type="button" data-view-alumnus="${esc(r.id)}">View</button>
          ${isSuperAdmin ? `
            <button class="action-link" type="button" data-edit-alumnus="${esc(r.id)}">Edit</button>
            <button class="action-link" type="button" data-delete-alumnus="${esc(r.id)}">Delete</button>
          ` : ''}
        </td>
      </tr>
    `).join('') : `
      <tr><td colspan="7" class="empty-cell">No alumni birthdays in ${esc(selectedMonth)}.</td></tr>
    `;
    const monthSelectAll = $('select-visible-month-alumni');
    if (monthSelectAll) {
      monthSelectAll.hidden = !isSuperAdmin;
      monthSelectAll.checked = isSuperAdmin && rows.length > 0 &&
        rows.every(r => selectedAlumniIds.has(String(r.id)));
    }
  }

  function monthRows() {
    return selectedMonth
      ? alumni.filter(r => birthdayMonthValue(r.birth_month) === selectedMonth)
          .sort((a, b) => Number(a.birth_day || 0) - Number(b.birth_day || 0))
      : [];
  }


  $('select-visible-month-alumni')?.addEventListener('change', event => {
    if (!isSuperAdmin) return;
    monthRows().forEach(record => {
      const id = String(record.id);
      if (event.target.checked) selectedAlumniIds.add(id);
      else selectedAlumniIds.delete(id);
    });
    selectMonth(selectedMonth);
  });

  $('month-table')?.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-select-alumnus]');
    if (!checkbox || !isSuperAdmin) return;
    const id = String(checkbox.dataset.selectAlumnus);
    if (checkbox.checked) selectedAlumniIds.add(id);
    else selectedAlumniIds.delete(id);
    selectMonth(selectedMonth);
  });

  $('download-month-xlsx')?.addEventListener(
    'click',
    downloadMonthExcel
  );

  $('download-month-photos')?.addEventListener(
    'click',
    downloadMonthPhotos
  );

  function downloadMonthExcel() {
    const rows = monthRows();

    if (!selectedMonth) {
      alert('Select a month first.');
      return;
    }

    if (!window.XLSX) {
      alert(
        'Excel export library did not load. Check your internet connection and reload the dashboard.'
      );
      return;
    }

    const data = rows.map(r => ({
      'Title / Alias': r.alias || '',
      'First name': r.first_name || '',
      'Surname': r.surname || '',
      'Full name': fullName(r),
      'Email': r.email || '',
      'Phone': r.phone || '',
      'Birthday month': r.birth_month || '',
      'Birthday day': r.birth_day || '',
      'Graduation year': r.graduation_year || '',
      'Profession': r.profession || '',
      'Photo path': r.photo_path || '',
      'Date registered': r.created_at
        ? new Date(r.created_at).toISOString()
        : ''
    }));

    const wb = XLSX.utils.book_new();

    const ws = XLSX.utils.json_to_sheet(
      data.length
        ? data
        : [{
            'Notice':
              'No alumni registrations were recorded for this month.'
          }]
    );

    ws['!cols'] = [
      { wch: 18 }, { wch: 18 }, { wch: 18 },
      { wch: 30 }, { wch: 30 }, { wch: 18 },
      { wch: 18 }, { wch: 14 }, { wch: 16 },
      { wch: 26 }, { wch: 45 }, { wch: 26 }
    ];

    XLSX.utils.book_append_sheet(
      wb,
      ws,
      'Registrations'
    );

    XLSX.writeFile(
      wb,
      `CACSF_Birthday_Month_${selectedMonth}.xlsx`
    );

    audit(
      'monthly_excel_exported',
      'alumni',
      selectedMonth,
      { record_count: rows.length }
    );
  }

  async function downloadMonthPhotos() {
    const rows = monthRows().filter(r => r.photo_path);

    if (!selectedMonth) {
      alert('Select a month first.');
      return;
    }

    if (!window.JSZip) {
      alert(
        'ZIP library did not load. Check your internet connection and reload the dashboard.'
      );
      return;
    }

    if (!rows.length) {
      alert('There are no profile photos for this month.');
      return;
    }

    const button = $('download-month-photos');

    setBusy(button, true, 'Preparing ZIP…');

    try {
      const zip = new JSZip();

      const folder = zip.folder(
        `CACSF_Birthday_Month_Photos_${selectedMonth}`
      );

      const failures = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        try {
          const url = publicUrl(r.photo_path);
          const response = await fetch(url);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const blob = await response.blob();

          const ext =
            (r.photo_path.split('.').pop() || 'jpg')
              .split('?')[0]
              .replace(/[^a-z0-9]/gi, '') || 'jpg';

          const base =
            `${fullName(r).replace(/[^a-z0-9_-]+/gi, '_')}_${r.id || i + 1}`;

          folder.file(`${base}.${ext}`, blob);

          button.textContent =
            `Adding ${i + 1}/${rows.length}…`;

        } catch (e) {
          failures.push(
            `${fullName(r)} (${e.message})`
          );
        }
      }

      if (Object.keys(folder.files).length === 0) {
        throw new Error(
          'No photos could be downloaded. Check that the storage bucket is public or that authenticated download policies allow access.'
        );
      }

      if (failures.length) {
        folder.file(
          'DOWNLOAD_NOTES.txt',
          `Some photos could not be downloaded:\n${failures.join('\n')}`
        );
      }

      const blob = await zip.generateAsync({
        type: 'blob'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download =
        `CACSF_Alumni_Photos_${selectedMonth}.zip`;

      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);

      if (failures.length) {
        alert(
          `${rows.length - failures.length} photo(s) added. ${failures.length} could not be downloaded; see DOWNLOAD_NOTES.txt in the ZIP.`
        );
      }

      audit(
        'monthly_photos_zip_downloaded',
        'alumni',
        selectedMonth,
        {
          photo_count: rows.length - failures.length,
          failed_count: failures.length
        }
      );

    } catch (e) {
      alert(
        `Photo ZIP could not be created: ${e.message}`
      );
    } finally {
      setBusy(button, false);
    }
  }

  $('directory-export')?.addEventListener('click', () => {
    if (!window.XLSX) {
      alert('Excel export library did not load.');
      return;
    }

    const data = alumni.map(r => ({
      'Title / Alias': r.alias || '',
      'First name': r.first_name || '',
      'Surname': r.surname || '',
      'Full name': fullName(r),
      'Email': r.email || '',
      'Phone': r.phone || '',
      'Birthday month': r.birth_month || '',
      'Birthday day': r.birth_day || '',
      'Graduation year': r.graduation_year || '',
      'Profession': r.profession || '',
      'Photo path': r.photo_path || '',
      'Date registered': r.created_at || ''
    }));

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data),
      'All Alumni'
    );

    XLSX.writeFile(
      wb,
      `CACSF_All_Alumni_${new Date().toISOString().slice(0, 10)}.xlsx`
    );

    audit(
      'alumni_directory_exported',
      'alumni',
      null,
      { record_count: alumni.length }
    );
  });

  /* ==========================================================
     ALUMNI DETAILS, EDITING AND DELETION
     ========================================================== */

  function getAlumnus(id) {
    return alumni.find(
      r => String(r.id) === String(id)
    );
  }

  /*
   * Permanently delete one alumni registration.
   * This operation is available to Super Admins only.
   *
   * The database deletion is performed first.
   * The profile photo is removed only after the database
   * confirms that the alumni row was deleted.
   */

  async function deleteAlumnus(id, button) {
    if (!isSuperAdmin) {
      alert(
        'Only a Super Admin can delete alumni records.'
      );
      return;
    }

    const record = getAlumnus(id);

    if (!record) {
      alert(
        'This alumni record could not be found. Refresh the dashboard and try again.'
      );
      return;
    }

    const name = fullName(record);

    const confirmed = window.confirm(
      `PERMANENTLY DELETE THIS ALUMNI RECORD?\n\n` +
      `Name: ${name}\n` +
      `Email: ${record.email || 'Not provided'}\n\n` +
      `The registration record will be permanently deleted.\n` +
      `Its profile photograph will also be removed from CACSF storage, if one exists.\n\n` +
      `This action cannot be undone.\n\n` +
      `Do you want to continue?`
    );

    if (!confirmed) return;

    setBusy(button, true, 'Deleting…');

    try {
      // Verify the current account's Super Admin permission again.
      const {
        data: stillSuperAdmin,
        error: roleError
      } = await client.rpc('is_cacsf_super_admin');

      if (roleError) {
        throw new Error(
          `Could not verify Super Admin permission: ${roleError.message}`
        );
      }

      if (stillSuperAdmin !== true) {
        throw new Error(
          'Your Super Admin permission is no longer active. The alumni record was not deleted.'
        );
      }

      // Delete the alumni database row and return its ID.
      const { data: deletedRows, error: deleteError } =
        await client
          .from('alumni')
          .delete()
          .eq('id', id)
          .select('id');

      if (deleteError) {
        throw deleteError;
      }

      // Do not report success if Supabase deleted no row.
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error(
          'Supabase did not delete this record. Check the alumni table DELETE Row Level Security policy and try again.'
        );
      }

      // Remove the profile photo after the database deletion succeeds.
      if (record.photo_path) {
        await storageRemove(record.photo_path);
      }

      // Record the deletion in the existing audit log.
      await audit(
        'alumnus_record_deleted',
        'alumni',
        id,
        {
          name,
          email: record.email || null,
          photo_path: record.photo_path || null
        }
      );

      // Remove the deleted record from the local dashboard data.
      alumni = alumni.filter(
        r => String(r.id) !== String(id)
      );
      selectedAlumniIds.delete(String(id));

      // Refresh all dashboard sections and monthly counts.
      renderAll();

      alert(
        `${name} has been successfully deleted from the CACSF alumni directory.`
      );

    } catch (error) {
      console.error(
        'Alumni deletion failed:',
        error
      );

      alert(
        `Could not delete this alumni record:\n\n${error.message}`
      );

    } finally {
      setBusy(button, false);
    }
  }

  document.addEventListener('click', e => {
    const view =
      e.target.closest('[data-view-alumnus]');

    const edit =
      e.target.closest('[data-edit-alumnus]');

    const remove =
      e.target.closest('[data-delete-alumnus]');

    if (view) {
      showDetails(view.dataset.viewAlumnus);
    }

    if (edit && isSuperAdmin) {
      openEdit(edit.dataset.editAlumnus);
    }

    if (remove && isSuperAdmin) {
      deleteAlumnus(
        remove.dataset.deleteAlumnus,
        remove
      );
    }
  });

  function showDetails(id) {
    const r = getAlumnus(id);
    if (!r) return;

    audit(
      'alumnus_record_viewed',
      'alumni',
      id,
      {}
    );

    const fields = [
      ['Full name', fullName(r)],
      ['Email', r.email],
      ['Phone', r.phone],
      [
        'Birthday',
        [r.birth_month, r.birth_day]
          .filter(Boolean).join(' ')
      ],
      ['Graduation year', r.graduation_year],
      ['Profession', r.profession],
      ['Registered', fmtDate(r.created_at)],
      ['Profile photo', r.photo_path]
    ];

    const photo = r.photo_path
      ? `
        <div class="detail-cell">
          <small>Profile photo</small>
          <img
            class="details-photo"
            src="${esc(publicUrl(r.photo_path))}"
            alt="${esc(fullName(r))}"
          >
        </div>
      `
      : '';

    $('alumni-details-content').innerHTML =
      fields
        .filter(([k, v]) =>
          k !== 'Profile photo' && v
        )
        .map(([k, v]) => `
          <div class="detail-cell">
            <small>${esc(k)}</small>
            <b>${esc(v)}</b>
          </div>
        `).join('') + photo;

    $('alumni-details-dialog').showModal();
  }

  function openEdit(id) {
    if (!isSuperAdmin) return;

    const r = getAlumnus(id);
    if (!r) return;

    const form = $('alumni-edit-form');

    form.reset();

    [
      'id',
      'alias',
      'first_name',
      'surname',
      'email',
      'birth_month',
      'birth_day',
      'graduation_year',
      'phone',
      'profession'
    ].forEach(k => {
      if (form.elements[k]) {
        form.elements[k].value = r[k] ?? '';
      }
    });

    say('edit-status', '');

    $('alumni-dialog').showModal();
  }

  function closeDialog(id) {
    const d = $(id);
    if (d?.open) d.close();
  }

  [
    'close-edit',
    'cancel-edit'
  ].forEach(id => {
    $(id)?.addEventListener('click', () => {
      closeDialog('alumni-dialog');
    });
  });

  [
    'close-details',
    'details-close-button'
  ].forEach(id => {
    $(id)?.addEventListener('click', () => {
      closeDialog('alumni-details-dialog');
    });
  });

  $('alumni-edit-form')?.addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      if (!isSuperAdmin) return;

      const form = e.currentTarget;
      const id = form.elements.id.value;
      const old = getAlumnus(id);

      if (!old) return;

      const save =
        form.querySelector('[type="submit"]');

      setBusy(save, true, 'Saving…');

      say('edit-status', 'Updating alumni record…');

      let newPhotoPath = null;

      try {
        const payload = {};

        [
          'alias',
          'first_name',
          'surname',
          'email',
          'birth_month',
          'phone',
          'profession'
        ].forEach(k => {
          payload[k] =
            form.elements[k].value.trim() || null;
        });

        payload.birth_day =
          Number(form.elements.birth_day.value);

        payload.graduation_year =
          Number(form.elements.graduation_year.value);

        const photo = form.elements.photo.files[0];

        if (photo) {
          if (!photo.type.startsWith('image/')) {
            throw new Error(
              'Please choose an image file for the profile photo.'
            );
          }

          const ext =
            (photo.name.split('.').pop() || 'jpg').toLowerCase();

          newPhotoPath =
            `alumni/${crypto.randomUUID()}.${ext}`;

          const { error: uploadError } =
            await client.storage
              .from(BUCKET)
              .upload(
                newPhotoPath,
                photo,
                {
                  upsert: false,
                  contentType: photo.type
                }
              );

          if (uploadError) throw uploadError;

          payload.photo_path = newPhotoPath;
        }

        const { error } = await client
          .from('alumni')
          .update(payload)
          .eq('id', id);

        if (error) throw error;

        if (newPhotoPath && old.photo_path) {
          await storageRemove(old.photo_path);
        }

        await audit(
          'alumnus_record_updated',
          'alumni',
          id,
          {}
        );

        say(
          'edit-status',
          'Alumni record updated successfully.',
          'success'
        );

        closeDialog('alumni-dialog');

        await loadAll();

      } catch (error) {
        if (newPhotoPath) {
          await storageRemove(newPhotoPath);
        }

        say(
          'edit-status',
          `Could not save changes: ${error.message}`,
          'error'
        );

      } finally {
        setBusy(save, false);
      }
    }
  );

  /* ==========================================================
     MEDIA LIBRARY
     ========================================================== */

  function renderMedia() {
    const filtered = media.filter(r =>
      mediaFilter === 'all' ||
      r.category === mediaFilter
    );

    $('media-filter-count').textContent =
      `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

    $('media-library').innerHTML = filtered.length
      ? [...filtered]
          .sort(dateSort)
          .map(r => {
            const url = publicUrl(r.file_path);
            const isVideo = r.category === 'videos';

            const preview = isVideo
              ? `
                <video
                  src="${esc(url)}"
                  controls
                  preload="metadata"
                ></video>
              `
              : `
                <img
                  src="${esc(url)}"
                  alt="${esc(r.caption || 'CACSF media')}"
                >
              `;

            return `
              <article class="media-item">
                ${preview}

                <div class="media-item-body">
                  <b>${esc(
                    r.caption ||
                    (isVideo ? 'Reunion video' : 'CACSF media')
                  )}</b>

                  <small>
                    ${esc(r.year || '')}
                    · ${esc(r.category || '')}
                    · ${esc(fmtDate(r.created_at))}
                  </small>

                  <div class="item-actions">
                    <a
                      class="button"
                      href="${esc(url)}"
                      target="_blank"
                      rel="noopener"
                    >Open</a>

                    <a
                      class="button"
                      href="${esc(url)}"
                      download
                    >Download</a>

                    ${isSuperAdmin ? `
                      <button
                        class="button button-danger"
                        type="button"
                        data-delete-media="${esc(r.id)}"
                      >Delete</button>
                    ` : ''}
                  </div>
                </div>
              </article>
            `;
          }).join('')
      : '<div class="empty-cell">No media items in this category.</div>';
  }

  document
    .querySelectorAll('[data-media-filter]')
    .forEach(btn => {
      btn.addEventListener('click', () => {
        mediaFilter = btn.dataset.mediaFilter;

        document
          .querySelectorAll('[data-media-filter]')
          .forEach(x => {
            x.classList.toggle('selected', x === btn);
          });

        renderMedia();
      });
    });

  /* ==========================================================
     PROJECT GALLERY
     ========================================================== */

  function renderProjects() {
    $('project-library-count').textContent =
      `${projects.length} item${projects.length === 1 ? '' : 's'}`;

    $('project-library').innerHTML = projects.length
      ? [...projects]
          .sort(dateSort)
          .map(r => {
            const url = publicUrl(r.file_path);

            return `
              <article class="project-item">
                <a
                  href="${esc(url)}"
                  target="_blank"
                  rel="noopener"
                >
                  <img
                    src="${esc(url)}"
                    alt="${esc(r.caption || 'Project update')}"
                  >
                </a>

                <div class="project-item-body">
                  <b>${esc(r.caption || 'Project update')}</b>

                  <small>${esc(fmtDate(r.created_at))}</small>

                  <div class="item-actions">
                    <a
                      class="button"
                      href="${esc(url)}"
                      target="_blank"
                      rel="noopener"
                    >Open</a>

                    ${isSuperAdmin ? `
                      <button
                        class="button button-danger"
                        type="button"
                        data-delete-project="${esc(r.id)}"
                      >Delete</button>
                    ` : ''}
                  </div>
                </div>
              </article>
            `;
          }).join('')
      : '<div class="empty-cell">No project updates have been published.</div>';
  }

  /* ==========================================================
     MEDIA AND PROJECT UPLOADS
     ========================================================== */

  async function uploadAndInsert(
    formId,
    statusId,
    table,
    folder,
    buildRow,
    validate
  ) {
    const form = $(formId);
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();

      if (!isSuperAdmin) {
        say(
          statusId,
          'Only a Super Admin can publish this content.',
          'error'
        );
        return;
      }

      const file = form.elements.file?.files?.[0];

      if (!file) {
        say(statusId, 'Please choose a file.', 'error');
        return;
      }

      if (validate && !validate(file, form)) {
        say(
          statusId,
          'This file type is not allowed for the selected category.',
          'error'
        );
        return;
      }

      const submit =
        form.querySelector('[type="submit"]');

      setBusy(submit, true, 'Uploading…');

      say(
        statusId,
        'Uploading file to Supabase Storage…'
      );

      let path = null;

      try {
        const ext =
          (file.name.split('.').pop() || 'bin')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '') || 'bin';

        path =
          `${folder}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } =
          await client.storage
            .from(BUCKET)
            .upload(
              path,
              file,
              {
                upsert: false,
                contentType:
                  file.type || 'application/octet-stream'
              }
            );

        if (uploadError) throw uploadError;

        const row = buildRow(
          new FormData(form),
          path
        );

        const { error: insertError } =
          await client.from(table).insert(row);

        if (insertError) throw insertError;

        await audit(
          table === 'media'
            ? 'media_uploaded'
            : 'project_uploaded',
          table,
          null,
          { caption: row.caption || null }
        );

        say(
          statusId,
          'Upload published successfully.',
          'success'
        );

        form.reset();

        await loadAll();

      } catch (error) {
        if (path) {
          await storageRemove(path);
        }

        say(
          statusId,
          `Upload failed: ${error.message}`,
          'error'
        );

      } finally {
        setBusy(submit, false);
      }
    });
  }

  uploadAndInsert(
    'media-upload',
    'upload-status',
    'media',
    'admin-media',
    (f, path) => ({
      year: Number(f.get('year')),
      category: f.get('category'),
      caption: f.get('caption') || null,
      file_path: path
    }),
    (file, form) => {
      const category = form.elements.category.value;

      if (category === 'videos') {
        return [
          'video/mp4',
          'video/webm'
        ].includes(file.type);
      }

      return file.type.startsWith('image/');
    }
  );

  uploadAndInsert(
    'project-upload',
    'project-status',
    'project_gallery',
    'projects',
    (f, path) => ({
      caption: f.get('caption') || null,
      file_path: path
    }),
    file => file.type.startsWith('image/')
  );

  /* ==========================================================
     DELETE MEDIA AND PROJECT ITEMS
     ========================================================== */

  document.addEventListener('click', async e => {
    const mediaBtn =
      e.target.closest('[data-delete-media]');

    const projectBtn =
      e.target.closest('[data-delete-project]');

    if (!isSuperAdmin) return;

    if (mediaBtn) {
      const row = media.find(
        x => String(x.id) === mediaBtn.dataset.deleteMedia
      );

      if (
        !row ||
        !confirm('Delete this media item from the website?')
      ) {
        return;
      }

      mediaBtn.disabled = true;

      const { error } = await client
        .from('media')
        .delete()
        .eq('id', row.id);

      if (error) {
        alert(
          `Could not delete media record: ${error.message}`
        );

        mediaBtn.disabled = false;
        return;
      }

      await audit(
        'media_deleted',
        'media',
        row.id,
        {}
      );

      await storageRemove(row.file_path);
      await loadAll();
    }

    if (projectBtn) {
      const row = projects.find(
        x => String(x.id) === projectBtn.dataset.deleteProject
      );

      if (
        !row ||
        !confirm('Delete this project update from the website?')
      ) {
        return;
      }

      projectBtn.disabled = true;

      const { error } = await client
        .from('project_gallery')
        .delete()
        .eq('id', row.id);

      if (error) {
        alert(
          `Could not delete project record: ${error.message}`
        );

        projectBtn.disabled = false;
        return;
      }

      await audit(
        'project_deleted',
        'project_gallery',
        row.id,
        {}
      );

      await storageRemove(row.file_path);
      await loadAll();
    }
  });

  /* ==========================================================
     CONTACT MESSAGES
     ========================================================== */

  function renderMessages() {
    const q = (
      $('message-search')?.value || ''
    ).trim().toLowerCase();

    const rows = messages
      .filter(r =>
        [
          r.name,
          r.email,
          r.subject,
          r.message
        ].join(' ').toLowerCase().includes(q)
      )
      .sort(dateSort);

    $('messages-table').innerHTML = rows.length
      ? rows.map(r => `
          <tr>
            <td>
              ${esc(r.name || '—')}
              <br>
              <small>${esc(r.email || '')}</small>
            </td>

            <td>${esc(r.subject || '—')}</td>

            <td style="white-space:normal;min-width:220px;max-width:460px">
              ${esc(r.message || '')}
            </td>

            <td>${esc(fmtDate(r.created_at))}</td>
          </tr>
        `).join('')
      : `
          <tr>
            <td colspan="4" class="empty-cell">
              No matching messages found.
            </td>
          </tr>
        `;
  }

  $('message-search')?.addEventListener(
    'input',
    renderMessages
  );

  /* ==========================================================
     PASSWORD UPDATE
     ========================================================== */

  $('password-form')?.addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      const form = e.currentTarget;

      const password =
        form.elements.password.value;

      const confirmPassword =
        form.elements.confirm.value;

      if (password.length < 8) {
        say(
          'password-status',
          'Password must contain at least 8 characters.',
          'error'
        );
        return;
      }

      if (password !== confirmPassword) {
        say(
          'password-status',
          'The passwords do not match.',
          'error'
        );
        return;
      }

      const button =
        form.querySelector('[type="submit"]');

      setBusy(button, true, 'Updating…');

      say(
        'password-status',
        'Updating your password…'
      );

      const { error } =
        await client.auth.updateUser({ password });

      setBusy(button, false);

      if (error) {
        say(
          'password-status',
          `Password update failed: ${error.message}`,
          'error'
        );
      } else {
        form.reset();

        say(
          'password-status',
          'Your password has been updated successfully.',
          'success'
        );
      }
    }
  );

  /* ==========================================================
     RENDER ALL DASHBOARD SECTIONS
     ========================================================== */

  function renderAll() {
    renderOverview();
    renderDirectory();
    renderBirthdays();

    initMonthYear();
    renderMonthGrid();

    if (selectedMonth) {
      selectMonth(selectedMonth);
    }

    renderMedia();
    renderProjects();
    renderMessages();
  }

  /* ==========================================================
     START DASHBOARD
     ========================================================== */

  requireSession();

})();
