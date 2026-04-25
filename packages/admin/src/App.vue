<template>
  <div class="admin-layout">
    <nav class="admin-nav">
      <router-link to="/" class="nav-brand">Lexiklar Admin</router-link>
      <div class="nav-links">
        <router-link to="/">Dashboard</router-link>
        <router-link to="/reports">Reports</router-link>
      </div>
    </nav>
    <main class="admin-main">
      <router-view />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
}

.admin-layout {
  min-height: 100vh;
}

.admin-nav {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 0.75rem 1.5rem;
  background: #1a73e8;
  color: white;
}

.nav-brand {
  font-weight: 600;
  font-size: 1.1rem;
  color: white;
  text-decoration: none;
}

.nav-links {
  display: flex;
  gap: 1rem;
}

.nav-links a {
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: background 0.15s;
}

.nav-links a:hover {
  background: rgba(255, 255, 255, 0.15);
}

.nav-links a.router-link-active {
  color: white;
  background: rgba(255, 255, 255, 0.2);
}

.admin-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
</style>
