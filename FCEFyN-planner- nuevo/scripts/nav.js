import { createQuickSidebar } from "../ui/sidebar.js";

export const navItems = [
  { id:"inicio", label:"Inicio", icon:"🏠" },
  { id:"estudio", label:"Estudio", icon:"🟨" },
  { id:"academico", label:"Académico", icon:"🎓" },
  { id:"agenda", label:"Agenda", icon:"🗓️" },
  { id:"materias", label:"Materias", icon:"📚" },
  { id:"planificador", label:"Planificador", icon:"🧩" },
  { id:"profesores", label:"Profesores", icon:"⭐" },
  { id:"mensajes", label:"Mensajes", icon:"💬" },
  { id:"perfil", label:"Perfil", icon:"👤" },
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
      title: ctx.title || "Accesos rápidos",
      subtitle: ctx.subtitle || "Navegación principal",
      footer: ctx.footer || "Elegí sección",
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
