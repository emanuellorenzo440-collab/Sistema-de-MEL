import { getApiBaseUrl } from "./mel-api.js?v=20260601a";

export const DEFAULT_ORGANIZATION_BRANDING = {
  organization: {
    id: "org-convoy-of-hope",
    name: "Convoy of Hope",
    slug: "convoy-of-hope",
  },
  branding: {
    productName: "Nexora",
    organizationName: "Convoy of Hope",
    loginTagline: "Plataforma operacional personalizada para Convoy of Hope",
    loginLead:
      "Entra con tus credenciales institucionales para continuar con reportes, aprobaciones y seguimiento operativo de Convoy of Hope.",
    sidebarCaption: "Convoy of Hope",
    topbarEyebrow: "Nexora | Convoy of Hope",
    brandLogoPath: "assets/convoy-of-hope-logo.jpg",
    loginHeroPath: "assets/convoy-of-hope-hero.jpg",
    primaryColor: "#c5332f",
    primaryDarkColor: "#972623",
    accentColor: "#2f85c7",
    enabledModules: ["dashboard", "report", "indicators", "design", "forms", "charts", "chat", "attendance", "concepts", "supervision", "programs", "access"],
  },
};

export const MASTER_ORGANIZATION_BRANDING = {
  organization: {
    id: "org-nexora-admin",
    name: "Nexora Admin",
    slug: "nexora-admin",
  },
  branding: {
    productName: "Nexora",
    organizationName: "Nexora Admin",
    loginTagline: "Portal maestro para administrar organizaciones, branding y modulos de Nexora",
    loginLead: "Entra con tu cuenta global para crear organizaciones y preparar sus portales sin depender de ningun tenant operativo.",
    sidebarCaption: "Control maestro",
    topbarEyebrow: "Nexora | Portal maestro",
    brandLogoPath: "assets/nexora-admin-logo.svg",
    loginHeroPath: "assets/nexora-admin-hero.svg",
    primaryColor: "#11446b",
    primaryDarkColor: "#0a2c46",
    accentColor: "#27c1da",
    enabledModules: ["access"],
  },
};

const ORGANIZATION_QUERY_KEYS = ["organizationId", "org", "organizationSlug", "orgSlug"];

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveAssetPath(assetPath = "") {
  const normalized = String(assetPath || "").trim();
  if (!normalized) return "";
  if (/^(https?:)?\/\//i.test(normalized) || normalized.startsWith("/")) return normalized;
  const relativePath = normalized.replace(/^\.\//, "");
  return new URL(`../../${relativePath}`, import.meta.url).href;
}

function currentUrl() {
  return new URL(window.location.href);
}

export function readRequestedOrganizationContext() {
  const url = currentUrl();
  const organizationId = url.searchParams.get("organizationId") || url.searchParams.get("org") || "";
  const requestedSlug = url.searchParams.get("organizationSlug") || url.searchParams.get("orgSlug") || "";
  const pathname = String(url.pathname || "/").trim();
  const inferredPathSlug =
    pathname === "/admin" || pathname.startsWith("/admin/")
      ? "nexora-admin"
      : pathname === "/convoy" || pathname.startsWith("/convoy/")
        ? "convoy-of-hope"
        : (pathname.match(/^\/portal\/([^/?#]+)/)?.[1] || "");
  const organizationSlug = requestedSlug || inferredPathSlug;
  return {
    organizationId: String(organizationId || "").trim(),
    organizationSlug: String(organizationSlug || "").trim(),
  };
}

export function defaultBrandingForRequestedPortal() {
  return readRequestedOrganizationContext().organizationSlug === "nexora-admin"
    ? MASTER_ORGANIZATION_BRANDING
    : DEFAULT_ORGANIZATION_BRANDING;
}

export function normalizeOrganizationBranding(payload = {}) {
  const fallback = DEFAULT_ORGANIZATION_BRANDING;
  const organization = {
    id: String(payload.organization?.id || payload.organizationId || fallback.organization.id).trim() || fallback.organization.id,
    name:
      String(payload.organization?.name || payload.branding?.organizationName || payload.organizationName || fallback.organization.name).trim() ||
      fallback.organization.name,
    slug: String(payload.organization?.slug || fallback.organization.slug).trim() || fallback.organization.slug,
    hostnames: Array.isArray(payload.organization?.hostnames) ? payload.organization.hostnames.slice() : [],
    primaryHostname: String(payload.organization?.primaryHostname || "").trim(),
    primaryPortalUrl: String(payload.organization?.primaryPortalUrl || "").trim(),
    fallbackPortalQuery: String(payload.organization?.fallbackPortalQuery || "").trim(),
  };

  const productName = String(payload.branding?.productName || fallback.branding.productName).trim() || fallback.branding.productName;
  const organizationName = organization.name;
  return {
    organization,
    branding: {
      productName,
      organizationName,
      loginTagline:
        String(payload.branding?.loginTagline || "").trim() ||
        `Plataforma operacional personalizada para ${organizationName}`,
      loginLead:
        String(payload.branding?.loginLead || "").trim() ||
        `Entra con tus credenciales institucionales para continuar con reportes, aprobaciones y seguimiento operativo de ${organizationName}.`,
      sidebarCaption: String(payload.branding?.sidebarCaption || "").trim() || organizationName,
      topbarEyebrow: String(payload.branding?.topbarEyebrow || "").trim() || `${productName} | ${organizationName}`,
      brandLogoPath: String(payload.branding?.brandLogoPath || fallback.branding.brandLogoPath).trim(),
      loginHeroPath: String(payload.branding?.loginHeroPath || fallback.branding.loginHeroPath).trim(),
      primaryColor: String(payload.branding?.primaryColor || fallback.branding.primaryColor).trim(),
      primaryDarkColor: String(payload.branding?.primaryDarkColor || fallback.branding.primaryDarkColor).trim(),
      accentColor: String(payload.branding?.accentColor || fallback.branding.accentColor).trim(),
      enabledModules: Array.isArray(payload.branding?.enabledModules) && payload.branding.enabledModules.length
        ? payload.branding.enabledModules.slice()
        : fallback.branding.enabledModules.slice(),
    },
  };
}

export function brandingFromUser(user = null, fallback = defaultBrandingForRequestedPortal()) {
  if (!user) return normalizeOrganizationBranding(fallback);
  return normalizeOrganizationBranding({
    organization: user.organization,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    branding: user.organizationSettings || user.organization?.settings || fallback.branding,
  });
}

export function applyOrganizationBranding(payload = DEFAULT_ORGANIZATION_BRANDING) {
  const normalized = normalizeOrganizationBranding(payload);
  const { organization, branding } = normalized;
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--brand-primary", branding.primaryColor);
  rootStyle.setProperty("--brand-primary-dark", branding.primaryDarkColor);
  rootStyle.setProperty("--brand-accent", branding.accentColor);
  rootStyle.setProperty("--brand-hero-image", `url("${resolveAssetPath(branding.loginHeroPath)}")`);
  document.documentElement.dataset.organizationId = organization.id;
  document.documentElement.dataset.organizationSlug = organization.slug;
  document.documentElement.dataset.organizationName = organization.name;

  document.title = branding.productName;

  const updateText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  const updateBrandImage = (id, ariaLabel) => {
    const image = document.getElementById(id);
    if (!image) return;
    image.src = resolveAssetPath(branding.brandLogoPath);
    image.alt = ariaLabel;
    const wrapper = image.closest(".brand-mark-logo");
    if (wrapper) wrapper.setAttribute("aria-label", ariaLabel);
  };

  updateText("authBrandProductName", branding.productName);
  updateText("authBrandSubtitle", branding.loginTagline);
  updateText("authLead", branding.loginLead);
  updateText("sidebarBrandProductName", branding.productName);
  updateText("sidebarBrandOrganization", branding.sidebarCaption);
  updateText("topbarEyebrow", branding.topbarEyebrow);
  updateBrandImage("authBrandLogo", organization.name);
  updateBrandImage("sidebarBrandLogo", organization.name);

  const portalShortcuts = document.getElementById("portalShortcuts");
  const convoyPortalShortcut = document.getElementById("convoyPortalShortcut");
  const adminPortalShortcut = document.getElementById("adminPortalShortcut");
  if (convoyPortalShortcut) convoyPortalShortcut.href = "/";
  if (adminPortalShortcut) adminPortalShortcut.href = "/admin";
  if (portalShortcuts) {
    portalShortcuts.hidden = organization.slug !== "nexora-admin";
  }

  return normalized;
}

export async function loadPublicOrganizationBranding(organizationId = "") {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return applyOrganizationBranding(defaultBrandingForRequestedPortal());
  }

  try {
    const selector = readRequestedOrganizationContext();
    const url = new URL(`${trimTrailingSlash(apiBaseUrl)}/${organizationId ? "organization/branding" : "organization/current"}`);
    const effectiveOrganizationId = String(organizationId || selector.organizationId || "").trim();
    const effectiveOrganizationSlug = String(selector.organizationSlug || "").trim();
    if (effectiveOrganizationId) url.searchParams.set("organizationId", effectiveOrganizationId);
    if (effectiveOrganizationSlug) url.searchParams.set("organizationSlug", effectiveOrganizationSlug);
    const response = await fetch(url.toString());
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "No pude cargar la configuracion de organizacion.");
    }
    return applyOrganizationBranding(body.data || defaultBrandingForRequestedPortal());
  } catch (error) {
    console.error("No pude cargar la configuracion publica de la organizacion.", error);
    return applyOrganizationBranding(defaultBrandingForRequestedPortal());
  }
}
