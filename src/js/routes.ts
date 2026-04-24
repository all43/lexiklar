import SearchPage from "../pages/SearchPage.vue";
import FavoritesPage from "../pages/FavoritesPage.vue";
import SettingsPage from "../pages/SettingsPage.vue";
import WordPage from "../pages/WordPage.vue";
import GrammarIndexPage from "../pages/grammar/GrammarIndexPage.vue";
import NounGenderPage from "../pages/grammar/NounGenderPage.vue";
import AdjectiveDeclensionPage from "../pages/grammar/AdjectiveDeclensionPage.vue";
import DeterminersPage from "../pages/grammar/DeterminersPage.vue";
import CasesPage from "../pages/grammar/CasesPage.vue";
import ModalVerbsPage from "../pages/grammar/ModalVerbsPage.vue";
import ReflexivePage from "../pages/grammar/ReflexivePage.vue";
import ConnectorsPage from "../pages/grammar/ConnectorsPage.vue";
import TensesPage from "../pages/grammar/TensesPage.vue";

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
    path: "/search/:query/",
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
  // Grammar reference pages
  {
    path: "/grammar/",
    component: GrammarIndexPage,
  },
  {
    path: "/grammar/noun-gender/",
    component: NounGenderPage,
  },
  {
    path: "/grammar/adjective-declension/",
    component: AdjectiveDeclensionPage,
  },
  {
    path: "/grammar/determiners/",
    component: DeterminersPage,
  },
  {
    path: "/grammar/cases/",
    component: CasesPage,
  },
  {
    path: "/grammar/modal-verbs/",
    component: ModalVerbsPage,
  },
  {
    path: "/grammar/reflexive/",
    component: ReflexivePage,
  },
  {
    path: "/grammar/connectors/",
    component: ConnectorsPage,
  },
  {
    path: "/grammar/tenses/",
    component: TensesPage,
  },
];

export default routes;
