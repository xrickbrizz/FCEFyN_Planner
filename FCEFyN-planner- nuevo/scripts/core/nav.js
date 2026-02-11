import { createQuickSidebar } from "../ui/sidebar.js";

export const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5L12 4l9 7.5"/><path d="M5 10.5V20h5v-5h4v5h5v-9.5"/></svg>`,
  study: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h12a3 3 0 0 1 3 3V19H7a3 3 0 0 0-3 3V5.5z"/><path d="M4 5.5v13.5a3 3 0 0 1 3-3h12"/></svg>`,
  academic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M7 10.5v5.5c0 1.7 2.2 3 5 3s5-1.3 5-3v-5.5"/></svg>`,
  agenda: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M8 3v3M16 3v3"/><path d="M3 9h18"/></svg>`,
  materias: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4.5" width="7" height="15" rx="2"/><rect x="13" y="4.5" width="7" height="15" rx="2"/></svg>`,
  plan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h9a4 4 0 0 1 4 4v8"/><path d="M20 18H7a3 3 0 0 1-3-3V6"/><path d="M7 11h7"/></svg>`,
  planificador: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"/><path d="M7 6v12"/><path d="M17 10v8"/><circle cx="7" cy="10" r="2.2"/><circle cx="17" cy="14" r="2.2"/></svg>`,
  profesores: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M17 7.5a3 3 0 1 1 0 6"/><path d="M17 13.5c2.2 0 4 1.8 4 4"/></svg>`,
  comunidad: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="8" r="2.5"/><path d="M3.5 19a4.5 4.5 0 0 1 9 0"/><path d="M13 18.5a3.8 3.8 0 0 1 7.5 0"/></svg>`,
  recreo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8.5h10a4 4 0 0 1 4 4v2.5a2 2 0 0 1-2 2h-1.5l-1.2-2.1A2.5 2.5 0 0 0 14.2 13h-4.4a2.5 2.5 0 0 0-2.1 1.2L6.5 17H5a2 2 0 0 1-2-2v-2.5a4 4 0 0 1 4-4z"/><path d="M8.5 10.5v3"/><path d="M7 12h3"/><circle cx="15.8" cy="11.3" r="1"/><circle cx="18.5" cy="13.7" r="1"/></svg>`,
  biblioteca: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H10v14H5.5A1.5 1.5 0 0 1 4 17.5z"/><path d="M10 5h5a1.5 1.5 0 0 1 1.5 1.5V19H10"/><path d="M16.5 8.5H20v10.5h-3.5"/></svg>`,
  transporte: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4.5" width="16" height="12" rx="3"/><path d="M4 10h16"/><path d="M7.5 16.5v3M16.5 16.5v3"/><circle cx="8" cy="19.5" r="1.5"/><circle cx="16" cy="19.5" r="1.5"/></svg>`
  
};

export const navItems = [
  { id:"inicio", label:"Inicio", icon:ICONS.home },
  { id:"estudio", label:"Estudio", icon:ICONS.study },
  { id:"academico", label:"Académico", icon:ICONS.academic },
  { id:"agenda", label:"Agenda", icon:ICONS.agenda },
  { id:"materias", label:"Materias", icon:ICONS.materias },
  { id:"planestudios", label:"Correlativas", icon:ICONS.plan },
  { id:"planificador", label:"Planificador", icon:ICONS.planificador },
  { id:"profesores", label:"Profesores", icon:ICONS.profesores },
  { id:"comunidad", label:"Comunidad", icon:ICONS.comunidad, comingSoon:true },
  { id:"recreo", label:"Recreo", icon:ICONS.recreo, comingSoon:true },
  { id:"biblioteca", label:"Biblioteca", icon:ICONS.biblioteca, comingSoon:true },
  { id:"transporte", label:"Transporte", icon:ICONS.transporte, comingSoon:true },
  //{ id:"mensajes", label:"Mensajes", icon:"💬" },
  //{ id:"perfil", label:"Perfil", icon:"👤" },
];

console.log("[nav] loaded");

export function initNav(ctx = {}) {
  console.log("[nav] init start", ctx);
  try {
    const mountId = ctx.mountId || "quickSidebarMount";
    const toggleId = ctx.toggleId || "sidebarToggle";
    const layoutId = ctx.layoutId || "pageLayout";
    const items = Array.isArray(ctx.items) && ctx.items.length ? ctx.items : navItems;
    const showTab = ctx.showTab;

    const mount = document.getElementById(mountId);
    console.log("[nav] sidebar container found?", !!mount);
    if (!mount) return null;

    items.forEach(item => {
      console.log("[nav] binding click", item.id);
    });

    const toggleBtn = document.getElementById(toggleId);
    const layout = document.getElementById(layoutId);
    let isPinned = false;

    const isMobile = () =>
      window.matchMedia && window.matchMedia("(max-width: 1024px)").matches;

    const sidebarCtrl = createQuickSidebar({
      mount,
      items,
      title: ctx.title || null,
      subtitle: ctx.subtitle || null,
      //footer: ctx.footer ,
      collapsed: ctx.collapsed ?? true,
      onSelect: id => {
        console.log("[nav] click -> section", id);
        if (typeof showTab === "function") {
          console.log("[nav] showTab called", id);
          showTab(id);
        }
        if (!isPinned && !isMobile()) collapseSidebar();
      }
    });

    function collapseSidebar() {
      if (!sidebarCtrl || isMobile()) return;
      sidebarCtrl.setCollapsed(true);
      layout?.classList.add("sidebar-collapsed");
    }

    function expandSidebar() {
      if (!sidebarCtrl) return;
      sidebarCtrl.setCollapsed(false);
      layout?.classList.remove("sidebar-collapsed");
    }

    if (layout && sidebarCtrl) {
      sidebarCtrl.setCollapsed(true);
      layout.classList.add("sidebar-collapsed");
    }

    mount.addEventListener("mouseenter", () => {
      if (!isMobile()) expandSidebar();
    });
    mount.addEventListener("mouseleave", () => {
      if (!isMobile() && !isPinned) collapseSidebar();
    });

    if (toggleBtn && sidebarCtrl) {
      toggleBtn.addEventListener("click", () => {
        if (isMobile()) {
          sidebarCtrl.toggle();
          return;
        }
        isPinned = !isPinned;
        toggleBtn.classList.toggle("active", isPinned);
        if (isPinned) expandSidebar();
        else collapseSidebar();
      });
    }

    if (ctx.activeSection) sidebarCtrl.setActive(ctx.activeSection);
    collapseSidebar();
    console.log("[nav] init done");
    return sidebarCtrl;
  } catch (e) {
    console.error("[nav] error", e);
    return null;
  }
}
