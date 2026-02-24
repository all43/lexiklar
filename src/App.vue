<template>
  <f7-app v-bind="f7params">

    <f7-views tabs>
      <!-- Tabbar at the bottom -->
      <f7-toolbar tabbar icons bottom>
        <f7-link tab-link="#tab-search" tab-link-active icon-f7="search" text="Search" />
        <f7-link tab-link="#tab-favorites" icon-f7="star" text="Favorites" />
        <f7-link tab-link="#tab-settings" icon-f7="gear" text="Settings" />
      </f7-toolbar>

      <!-- Tab views — each has its own navigation stack -->
      <f7-view id="tab-search" tab tab-active url="/" main :animate="true" />
      <f7-view id="tab-favorites" tab url="/favorites/" :animate="true" />
      <f7-view id="tab-settings" tab url="/settings/" :animate="true" />
    </f7-views>

  </f7-app>
</template>

<script>
import routes from "./js/routes.js";

export default {
  data() {
    return {
      f7params: {
        name: "Lexiklar",
        theme: "auto",
        routes,
      },
    };
  },
};
</script>
