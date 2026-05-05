import { sentences } from "./state.js";
import { getAudioTracks } from "./utils.js";

export function filteredSentences() {
  const q = (document.getElementById("search")?.value || "").toLowerCase().trim();
  const tag = document.getElementById("filter-tag")?.value || "";
  const fav = document.getElementById("filter-fav")?.value || "all";
  const sort = document.getElementById("sort-order")?.value || "newest";

  let list = [...sentences];

  if (q) {
    list = list.filter((s) => {
      const blob = [
        s.russian_text,
        s.japanese_text,
        s.kana,
        (s.tags || []).join(" "),
      ]
        .join("\n")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  if (tag) list = list.filter((s) => (s.tags || []).includes(tag));

  if (fav === "fav") list = list.filter((s) => s.favorite);

  list.sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return sort === "oldest" ? ta - tb : tb - ta;
  });

  return list;
}

export function playable(list) {
  return list.filter((s) => getAudioTracks(s).length > 0);
}
