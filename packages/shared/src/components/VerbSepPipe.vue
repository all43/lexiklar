<template>
  <span class="verb-sep-pipe" aria-hidden="true">
    <span class="verb-sep-chevron verb-sep-top" />
    <span class="verb-sep-bar" />
    <span class="verb-sep-chevron verb-sep-bottom" />
  </span>
</template>

<style scoped>
.verb-sep-pipe {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  vertical-align: middle;
  margin: 0 -0.06em;
  margin-bottom: 0.15em;
  opacity: 0.5;
}
.verb-sep-bar {
  width: 1px;
  height: 1.1em;
  background: currentColor;
}
.verb-sep-chevron {
  display: block;
  width: 0.25em;
  height: 0.25em;
  transform: rotate(45deg);
  border: 1px solid currentColor;
}
.verb-sep-top {
  border-top: 0;
  border-left: 0;
}
.verb-sep-bottom {
  border-right: 0;
  border-bottom: 0;
}
</style>
