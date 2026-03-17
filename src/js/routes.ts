import SearchPage from "../pages/SearchPage.vue";
import FavoritesPage from "../pages/FavoritesPage.vue";
import SettingsPage from "../pages/SettingsPage.vue";
import WordPage from "../pages/WordPage.vue";

interface Route {
  path: string;
  component: unknown;
}

const routes: Route[] = [
  // Tab routes
  {
    path: "/",
    component: SearchPage,
  },
  {
    path: "/favorites/",
    component: FavoritesPage,
  },
  {
    path: "/settings/",
    component: SettingsPage,
  },
  // Word detail (pushed onto search tab's navigation stack)
  {
    path: "/word/:pos/:file/",
    component: WordPage,
  },
];

export default routes;
