import { createQuickSidebar } from "../ui/sidebar.js";

export const ICONS = {
  home: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Inicio"><title>Inicio</title><path d="M3.6 11.4L12 3.9l8.4 7.5"/><path d="M6.2 10.7V20h11.6v-9.3"/><rect x="10" y="14" width="4" height="6"/></svg>`,
  study: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Estudio"><title>Estudio</title><path d="M3.5 6.2h4.9a3.2 3.2 0 0 1 3.2 3.2V19H6a2.5 2.5 0 0 0-2.5 2.5V6.2z"/><path d="M11.6 9.4a3.2 3.2 0 0 1 3.2-3.2h4.7V19h-5.7a2.2 2.2 0 0 0-2.2 2.2"/><path d="M16.8 4.4l2.5 2.5-3.2 3.2-2.8.4.4-2.8z"/><path d="M16.3 21.2h4.2"/><path d="M14.6 22.4h7.4"/></svg>`,
  academic: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Académico"><title>Académico</title><path d="M2.8 8.9L12 4.9l9.2 4L12 12.9z"/><path d="M5.8 10.6v4.1c0 2 2.8 3.7 6.2 3.7s6.2-1.7 6.2-3.7v-4.1"/><path d="M20.2 10.1v5.5"/></svg>`,
  agenda: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Agenda"><title>Agenda</title><rect x="3.5" y="5.4" width="17" height="15.1" rx="2.2"/><path d="M3.5 10h17"/><path d="M8 4v3.2"/><path d="M16 4v3.2"/><path d="M7 13.6h1.8"/><path d="M11.1 13.6h1.8"/><path d="M15.2 13.6h1.8"/><path d="M7 17h1.8"/><path d="M11.1 17h1.8"/><path d="M15.3 16.9l1 1 1.8-2"/></svg>`,
  materias: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Materias"><title>Materias</title><path d="M3.7 19.8h16.6"/><path d="M5.4 19.8v1.9"/><path d="M18.6 19.8v1.9"/><rect x="4.5" y="6.2" width="3.3" height="11.8" rx=".7"/><rect x="8.6" y="6" width="3.5" height="12" rx=".7"/><path d="M9.3 9.1h2"/><path d="M9.3 11.6h2"/><path d="M13.2 6.2l3.6-.9 2.6 10.8-3.6.9z"/><path d="M14.6 9.1l1.9-.5"/><path d="M15.2 11.5l1.9-.4"/></svg>`,
  plan: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Correlativas"><title>Correlativas</title><rect x="9.9" y="2.8" width="4.2" height="3.6" rx=".8"/><path d="M12 6.4V9"/><rect x="9.5" y="9" width="5" height="3.6" rx=".8"/><path d="M9.5 10.8H6.2v3.3"/><path d="M14.5 10.8h3.3v3.3"/><rect x="3.8" y="14.1" width="4.6" height="4.6" rx=".8"/><circle cx="12" cy="17.3" r="2.3"/><circle cx="17.8" cy="17.3" r="2.3"/></svg>`,
  planificador: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Planificador"><title>Planificador</title><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M7.1 8.4l1 1 1.9-2"/><rect x="6.6" y="14.6" width="2.8" height="2.8" rx=".3"/><path d="M11.7 7.5h4.7v3.2h-4.7z"/><path d="M14.2 10.7v2.2"/><path d="M14.2 12.9h4.2v3.2h-4.2z"/><path d="M11.7 16.2h4.7v3.2h-4.7z"/></svg>`,
  profesores: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Profesores"><title>Profesores</title><circle cx="6.8" cy="12" r="2.5"/><path d="M2.8 20a4 4 0 0 1 8 0"/><rect x="10.8" y="5.5" width="10.5" height="8.7" rx="1"/><path d="M12.8 8h6.4"/><path d="M12.8 10.7h4"/><path d="M17.6 14.2v2.1"/><path d="M14.2 16.3h3.4"/></svg>`,
  comunidad: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Comunidad"><title>Comunidad</title><circle cx="12" cy="8" r="2.8"/><circle cx="5.8" cy="9" r="2"/><circle cx="18.2" cy="9" r="2"/><path d="M6.2 20.2a5.8 5.8 0 0 1 11.6 0"/><path d="M2.6 19.9a4.1 4.1 0 0 1 4.3-3.6"/><path d="M21.4 19.9a4.1 4.1 0 0 0-4.3-3.6"/></svg>`,  
  recreo: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Recreo"><title>Recreo</title><path d="M8.2 7.1a3.2 3.2 0 0 1 3.1 1h1.4a3.2 3.2 0 0 1 3.1-1c3.2.5 5.4 3.8 4.9 6.9l-.8 4a2.7 2.7 0 0 1-2.7 2.2h-.2l-2.2-3.1a2.5 2.5 0 0 0-2-1h-1.6a2.5 2.5 0 0 0-2 1l-2.2 3.1h-.2A2.7 2.7 0 0 1 4 18l-.8-4c-.6-3.1 1.7-6.4 5-6.9z"/><path d="M8.2 10.2v2"/><path d="M7.2 11.2h2"/><circle cx="15.8" cy="10.8" r=".8"/><circle cx="17.9" cy="12.6" r=".8"/></svg>`,
  biblioteca: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Biblioteca"><title>Biblioteca</title><path d="M3.3 20.4h17.4"/><rect x="4.3" y="8" width="3.1" height="10.6" rx=".5"/><rect x="7.9" y="6.7" width="3.7" height="11.9" rx=".5"/><rect x="12.1" y="6.4" width="3.6" height="12.2" rx=".5"/><rect x="16.3" y="6.1" width="3.3" height="12.5" rx=".5" transform="rotate(-16 16.3 6.1)"/></svg>`,  
  transporte: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Transporte"><title>Transporte</title><rect x="5.2" y="3.5" width="13.6" height="16.8" rx="3.4"/><path d="M7.8 3.5h8.4"/><path d="M6.2 9.8h11.6"/><path d="M5.2 14.8h13.6"/><circle cx="8.5" cy="17.2" r="1.1"/><circle cx="15.5" cy="17.2" r="1.1"/><path d="M8 20.3v2"/><path d="M16 20.3v2"/><path d="M3.5 8.2v2.8"/><path d="M20.5 8.2v2.8"/></svg>`};

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
