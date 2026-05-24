import {
    appendMediaToMessage,
    eventSource,
    event_types,
    getRequestHeaders,
    saveSettingsDebounced,
    updateMessageBlock,
} from '../../../../script.js';
import {
    extension_settings,
    getContext,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';
import { NOTE_MODULE_NAME } from '../../../authors-note.js';
import { getGroupCharacterCards } from '../../../group-chats.js';
import { user_avatar } from '../../../personas.js';
import { loadMovingUIState } from '../../../power-user.js';
import {
    checkWorldInfo,
    selected_world_info,
    world_info,
    world_info_include_names,
} from '../../../world-info.js';
import { saveBase64AsFile } from '../../../utils.js';

const MODULE_NAME = 'st-chatgpt2api-image';
const EXTENSION_NAME = `third-party/${MODULE_NAME}`;
const PANEL_ID = 'st_chatgpt2api_image_panel';
const CONTROL_PANEL_ID = 'st_chatgpt2api_image_control_panel';
const CONTROL_FAB_ID = 'st_chatgpt2api_image_control_fab';
const PANEL_VISIBLE_CLASS = 'is-visible';
const PANEL_MAXIMIZED_CLASS = 'is-maximized';
const MESSAGE_ACTION_SELECTOR = '.st-chatgpt2api-image-message-actions';
const MESSAGE_BUTTON_SELECTOR = '.st-chatgpt2api-image-inline-button';
const MESSAGE_INLINE_SLOT_SELECTOR = '.st-chatgpt2api-image-inline-slot';
const MESSAGE_INLINE_SLOT_ACTIONS_SELECTOR = '.st-chatgpt2api-image-inline-slot-actions';
const MESSAGE_INLINE_SLOT_MEDIA_SELECTOR = '.st-chatgpt2api-image-inline-slot-media';
const MEDIA_REFRESH_RETRY_DELAYS = [0, 80, 220, 500, 1200, 2400];
const TOAST_TITLE = 'ChatGPT2API 生图';
const STATUS_TITLES = {
    info: '准备就绪',
    busy: '处理中',
    success: '处理完成',
    error: '处理失败',
};
const BUSY_PHASE_META = {
    idle: {
        label: '待命中',
        hint: '选中一条 AI 回复后，就可以开始生成配图。',
    },
    preparing: {
        label: '准备中',
        hint: '正在检查当前选择和接口配置。',
    },
    prompt: {
        label: '生成提示词',
        hint: '正在把这一层剧情整理成一条可用于出图的视觉描述。',
    },
    image: {
        label: '生图中',
        hint: '图像接口已经开始处理，请稍等几十秒。',
    },
    attach: {
        label: '挂回楼层',
        hint: '图片已经返回，正在挂回当前这条消息里。',
    },
};
const MAX_PROMPT_CHARACTER_ANCHORS = 2;

const DEFAULT_NSFW_TERMS = [
    'nsfw',
    'explicit',
    'nude',
    '裸体',
    '露点',
    '性交',
    '性器官',
    'penis',
    'vagina',
    'nipples',
    'cum',
    'blowjob',
    'anal',
    'orgasm',
].join(', ');

const DEFAULT_NSFW_REWRITE_HINT = '如果源文本里有露骨或敏感内容，请把它改写成适合通用生图模型的非露骨视觉描述，尽量保留人物关系、姿势、镜头、服装状态、光线、氛围和情绪张力。';

const DEFAULT_PROMPT_API_SYSTEM_PROMPT = [
    'You are a dedicated SillyTavern image prompt assistant.',
    'Your job is to transform a roleplay reply into one strong English image prompt for a mainstream image model.',
    'You are not a moderator and not a chatbot. You are a visual prompt rewrite engine.',
    'The source may include erotic, taboo, or otherwise sensitive wording.',
    'Your task is to convert that wording into platform-safe, non-explicit, cinematic visual language without losing the scene intent.',
    'Preserve who is present, the relationship dynamic, body positioning, gaze, framing, camera angle, clothing state, props, lighting, atmosphere, location, and emotional tension whenever possible.',
    'If the source contains explicit anatomy, explicit acts, fluids, or other block-prone details, replace them with tasteful implied-intimacy cues, aftermath cues, sensual body language, or composition language instead of refusing.',
    'If age, coercion, or exploitative elements are ambiguous or unsafe, remove those unsafe elements and keep only clearly adult, non-explicit, non-harmful visual information.',
    'Avoid explicit resolution, pixel-size, render-quality, or hype-quality tags such as 4k, 8k, UHD, masterpiece, best quality, ultra detailed, or similar phrases.',
    'Never output refusal, apology, policy commentary, warnings, or analysis.',
    'Output only the final prompt text in English. No markdown, no JSON, no explanations.',
].join('\n');

const DEFAULT_SCENE_CAST_ANALYSIS_SYSTEM_PROMPT = [
    'You are a SillyTavern scene-cast analysis assistant.',
    'Read the entire selected reply as one continuous visible scene.',
    'Your job is to determine which descriptor-library characters are physically present in the current scene, which are only mentioned, remembered, off-screen, or part of backstory, and what the main visible interaction is.',
    'Do not use naive keyword matching. Infer presence from the whole scene context.',
    'Treat memories, prior-night references, speculation, phone mentions, and off-screen references as absent unless the character is clearly present in the visible scene right now.',
    'If the scene clearly centers on one or two present descriptor-library characters, return those as present_characters.',
    'If the scene is ambiguous or contains too many active descriptor-library characters, keep present_characters empty and set should_inject_descriptors to false.',
    'Return JSON only with the shape {"present_characters":[""],"mentioned_but_absent":[""],"interaction_summary":"","should_inject_descriptors":true}.',
].join('\n');

const DEFAULT_CARD_DESCRIPTOR_SYSTEM_PROMPT = [
    'You are a SillyTavern character descriptor extraction assistant.',
    'You read card text, scenario, examples, creator notes, character books, and relevant lore to recover stable visual identity anchors for recurring characters.',
    'You are not summarizing the story. You are extracting reusable image identity descriptors.',
    'If the source includes erotic or sensitive wording, silently rewrite it into platform-safe identity language before reasoning.',
    'Never echo explicit lines verbatim. Keep only stable, reusable, non-explicit character identity information.',
    'Preserve species, clearly adult-coded age impression, body build, hair, face, eyes, styling, default clothing baseline, signature items, role, aura, and other persistent visual cues.',
    'Use world lore only to clarify identity; never let side lore overwrite direct card canon.',
    'If multiple recurring characters exist, split them into separate entries and keep each entry focused on one character only.',
    'Do not invent unsupported characters or temporary one-off bystanders.',
].join('\n');

const DEFAULT_PERSONA_DESCRIPTOR_SYSTEM_PROMPT = [
    'You are a SillyTavern persona descriptor extraction assistant.',
    'Read the user persona description together with any bound persona lorebook before answering.',
    'Extract one stable visual identity anchor that can be reused across image prompts.',
    'If the source contains erotic or sensitive wording, silently rewrite it into platform-safe appearance language before reasoning.',
    'Never echo explicit text. Preserve only persistent, clearly adult-coded, non-explicit appearance, styling, aura, and signature features.',
    'Keep the result concise, vivid, and reusable.',
].join('\n');

const PROMPT_ASSISTANT_RUNTIME_SCAFFOLD = [
    'Runtime workflow:',
    '1. First silently normalize any explicit or block-prone wording into safe visual semantics.',
    '2. Then preserve the same scene composition as much as possible using non-explicit language.',
    '3. Determine who is actually present in the visible scene before using any character descriptors.',
    '4. Prefer sensual implication, body language, wardrobe state, camera framing, and atmosphere over explicit anatomy or act labels.',
    '5. Avoid explicit output-resolution or hype-quality tags such as 4k, 8k, UHD, masterpiece, best quality, or ultra detailed.',
    '6. Never quote explicit source lines back to the user.',
    '7. Return only the final usable prompt text.',
].join('\n');

const CARD_DESCRIPTOR_RUNTIME_SCAFFOLD = [
    'Runtime workflow:',
    '1. First silently normalize any sensitive wording into safe identity cues.',
    '2. Extract only stable, reusable, non-explicit identity anchors.',
    '3. Prioritize direct character-card evidence, then character books, then matched active lore.',
    '4. If age or consent is ambiguous, keep only clearly adult-coded, non-harmful identity details.',
    '5. Return JSON only.',
].join('\n');

const PERSONA_DESCRIPTOR_RUNTIME_SCAFFOLD = [
    'Runtime workflow:',
    '1. First silently normalize any sensitive wording into safe appearance cues.',
    '2. Keep only persistent, reusable, non-explicit identity details.',
    '3. If age is ambiguous, keep only clearly adult-coded appearance cues.',
    '4. Return JSON only.',
].join('\n');

const defaultSettings = {
    enabled: true,
    connection_mode: 'browser',
    prompt_api_mode: 'openai',
    prompt_api_enabled: true,
    prompt_api_url: '',
    prompt_api_key: '',
    prompt_api_model: 'gcli-gemini-3-flash-preview',
    prompt_api_model_options: [],
    prompt_api_system_prompt: DEFAULT_PROMPT_API_SYSTEM_PROMPT,
    descriptor_card_system_prompt: DEFAULT_CARD_DESCRIPTOR_SYSTEM_PROMPT,
    descriptor_persona_system_prompt: DEFAULT_PERSONA_DESCRIPTOR_SYSTEM_PROMPT,
    image_api_url: '',
    image_api_key: '',
    image_model: 'gpt-image-2',
    nsfw_guard_enabled: true,
    nsfw_terms: DEFAULT_NSFW_TERMS,
    nsfw_rewrite_hint: DEFAULT_NSFW_REWRITE_HINT,
    descriptor_library: {
        cards: {},
        personas: {},
    },
    debug: false,
};

const runtimeState = {
    chatObserver: null,
    selectedMessageId: null,
    syncTimer: null,
    busyPhase: 'idle',
    mediaRefreshTimers: new Map(),
    chatSaveTimer: null,
};

let isGenerating = false;

function ensureSettings() {
    extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
    extension_settings[MODULE_NAME] = Object.assign({}, defaultSettings, extension_settings[MODULE_NAME]);
    return extension_settings[MODULE_NAME];
}

function isInlineImageButtonEnabled() {
    return ensureSettings().enabled !== false;
}

function cloneForStorage(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function scheduleCurrentChatSave(delay = 400) {
    if (runtimeState.chatSaveTimer) {
        clearTimeout(runtimeState.chatSaveTimer);
    }

    runtimeState.chatSaveTimer = window.setTimeout(async () => {
        runtimeState.chatSaveTimer = null;
        try {
            await getContext().saveChat();
        } catch (error) {
            console.warn('Failed to persist chat after syncing swipe image metadata', error);
        }
    }, delay);
}

function repairCurrentChatImageSwipeMetadata() {
    const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
    let changed = false;

    for (let index = 0; index < chat.length; index += 1) {
        const message = chat[index];
        if (!message?.extra) {
            continue;
        }

        const hasManagedImageState = !!(
            message.extra.image
            || (Array.isArray(message.extra.image_swipes) && message.extra.image_swipes.length)
            || message.extra.chatgpt2api_image_meta
        );

        if (!hasManagedImageState) {
            continue;
        }

        changed = syncMessageExtraToCurrentSwipe(message) || changed;
    }

    if (changed) {
        scheduleCurrentChatSave();
    }
}

function setStatus(text, type = '', title = '') {
    const normalizedType = type || 'info';
    const statusTitle = title || STATUS_TITLES[normalizedType] || STATUS_TITLES.info;

    const settingsStatus = $('#st_chatgpt2api_image_status');
    settingsStatus
        .removeClass('is-busy is-success is-error');

    if (normalizedType === 'busy') {
        settingsStatus.addClass('is-busy');
    }

    if (normalizedType === 'success') {
        settingsStatus.addClass('is-success');
    }

    if (normalizedType === 'error') {
        settingsStatus.addClass('is-error');
    }

    const settingsTitleElement = $('#st_chatgpt2api_image_status_title');
    const settingsTextElement = $('#st_chatgpt2api_image_status_text');

    if (settingsTitleElement.length && settingsTextElement.length) {
        settingsStatus.attr('data-status-type', normalizedType);
        settingsTitleElement.text(statusTitle);
        settingsTextElement.text(text);
    } else {
        settingsStatus.text(text);
    }

    const panelStatus = $('#st_chatgpt2api_image_panel_status');
    if (!panelStatus.length) {
        return;
    }

    panelStatus
        .removeClass('is-busy is-success is-error')
        .attr('data-status-type', normalizedType);

    if (normalizedType === 'busy') {
        panelStatus.addClass('is-busy');
    }

    if (normalizedType === 'success') {
        panelStatus.addClass('is-success');
    }

    if (normalizedType === 'error') {
        panelStatus.addClass('is-error');
    }

    const titleElement = $('#st_chatgpt2api_image_panel_status_title');
    const textElement = $('#st_chatgpt2api_image_panel_status_text');

    if (titleElement.length && textElement.length) {
        titleElement.text(statusTitle);
        textElement.text(text);
    } else {
        panelStatus.text(text);
    }
}

function getBusyPhaseMeta(phase) {
    return BUSY_PHASE_META[phase] || BUSY_PHASE_META.idle;
}

function setBusyPhase(phase, statusText = '', statusTitle = '') {
    runtimeState.busyPhase = phase;
    updateInteractiveState();

    if (statusText) {
        setStatus(statusText, phase === 'idle' ? 'info' : 'busy', statusTitle);
    }
}

function normalizeUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function isAbsoluteHttpUrl(url) {
    const normalized = normalizeUrl(url);

    if (!normalized || normalized.startsWith('/')) {
        return false;
    }

    try {
        const parsed = new URL(normalized, window.location.href);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
}

function buildOpenAiCompatibleEndpointUrl(baseUrl, endpointPath) {
    const normalizedBaseUrl = normalizeUrl(baseUrl);
    const normalizedEndpointPath = String(endpointPath || '').startsWith('/')
        ? String(endpointPath || '')
        : `/${String(endpointPath || '')}`;

    if (!normalizedBaseUrl) {
        return '';
    }

    if (normalizedBaseUrl.toLowerCase().endsWith(normalizedEndpointPath.toLowerCase())) {
        return normalizedBaseUrl;
    }

    if (/\/v\d+(?:beta\d+)?$/i.test(normalizedBaseUrl)) {
        return `${normalizedBaseUrl}${normalizedEndpointPath}`;
    }

    return `${normalizedBaseUrl}/v1${normalizedEndpointPath}`;
}

function isTavernConnectionMode(settings = ensureSettings()) {
    return String(settings.connection_mode || 'browser') === 'tavern';
}

function shouldUseSillyTavernPromptProxy(settings = ensureSettings()) {
    return isTavernConnectionMode(settings)
        && String(settings.prompt_api_mode || 'openai') === 'openai'
        && isAbsoluteHttpUrl(settings.prompt_api_url);
}

function getConnectionModeHint(settings = ensureSettings()) {
    if (isTavernConnectionMode(settings)) {
        return '酒馆模式下，提示词接口会优先借助 SillyTavern 后端代理；如果你填的是同源相对路径，则会直接走当前酒馆域名。生图接口建议优先填写同源代理路径，例如 /api/chatgpt2api/v1 或 /api/v1。';
    }

    return '浏览器模式会在前端直接请求你填写的接口地址。目标接口需要允许当前页面访问，并且在 HTTPS 酒馆里应优先使用 HTTPS 接口。';
}

function updateConnectionModeUi(settings = ensureSettings()) {
    $('#st_chatgpt2api_image_connection_mode_hint').text(getConnectionModeHint(settings));
}

function normalizeMessageId(messageId) {
    if (messageId === null || typeof messageId === 'undefined' || messageId === '') {
        return null;
    }

    const normalized = typeof messageId === 'number'
        ? messageId
        : Number.parseInt(String(messageId), 10);

    return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function uniqueStrings(values = []) {
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function parseSensitiveTerms(rawValue) {
    return uniqueStrings(String(rawValue || '').split(/[\n,，、]+/));
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSensitiveTermRegex(term) {
    const escaped = escapeRegExp(term);
    if (!escaped) {
        return null;
    }

    if (/[A-Za-z0-9]/.test(term)) {
        return new RegExp(`\\b${escaped}\\b`, 'gi');
    }

    return new RegExp(escaped, 'giu');
}

function normalizeWhitespace(text) {
    return String(text || '')
        .replace(/\s+,/g, ',')
        .replace(/\s+\./g, '.')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function sanitizePromptCapabilityHints(prompt) {
    return normalizeWhitespace(
        String(prompt || '')
            .replace(/\b(?:4k|6k|8k|10k|12k|16k|32k|64k|uhd|hdr)\b/gi, ' ')
            .replace(/\b(?:high[-\s]?resolution|ultra[-\s]?high[-\s]?resolution|super[-\s]?resolution)\b/gi, ' ')
            .replace(/\b(?:masterpiece|best quality|highest quality|ultra[-\s]?detailed|ultra[-\s]?detail|extremely detailed|hyper[-\s]?detailed)\b/gi, ' ')
            .replace(/\(\s*(?:4k|6k|8k|16k|uhd|hdr)\s*\)/gi, ' ')
            .replace(/\[\s*(?:4k|6k|8k|16k|uhd|hdr)\s*\]/gi, ' ')
            .replace(/\s{2,}/g, ' '),
    );
}

function sanitizeGeneratedPrompt(prompt, settings = ensureSettings()) {
    let sanitized = sanitizePromptCapabilityHints(String(prompt || '').trim());
    if (!sanitized) {
        return sanitized;
    }

    if (!settings.nsfw_guard_enabled) {
        return sanitized;
    }

    const sensitiveTerms = parseSensitiveTerms(settings.nsfw_terms);
    let removedSensitiveTerm = false;

    for (const term of sensitiveTerms) {
        const regex = buildSensitiveTermRegex(term);
        if (!regex) {
            continue;
        }

        const updated = sanitized.replace(regex, ' ');
        if (updated !== sanitized) {
            removedSensitiveTerm = true;
            sanitized = updated;
        }
    }

    sanitized = normalizeWhitespace(sanitized);

    if (removedSensitiveTerm && !/non-explicit|tasteful|implied intimacy/i.test(sanitized)) {
        sanitized = normalizeWhitespace(`${sanitized}, tasteful, non-explicit, implied intimacy, cinematic composition`);
    }

    return sanitizePromptCapabilityHints(sanitized);
}

const SAFE_SENSITIVE_TERM_REPLACEMENTS = {
    nsfw: 'suggestive scene',
    explicit: 'tasteful scene',
    nude: 'revealing pose',
    '裸体': 'revealing pose',
    '露点': 'covered body detail',
    '性交': 'intimate interaction',
    '性器官': 'intimate body detail',
    penis: 'intimate body detail',
    vagina: 'intimate body detail',
    nipples: 'covered body detail',
    cum: 'heightened intimacy',
    blowjob: 'close intimate pose',
    anal: 'intimate pose',
    orgasm: 'heightened emotion',
};

function getSafeSensitiveReplacement(term) {
    const normalized = String(term || '').trim().toLowerCase();

    if (!normalized) {
        return 'intimate detail';
    }

    if (SAFE_SENSITIVE_TERM_REPLACEMENTS[normalized]) {
        return SAFE_SENSITIVE_TERM_REPLACEMENTS[normalized];
    }

    if (/(sex|性交|性爱|做爱)/i.test(normalized)) {
        return 'intimate interaction';
    }

    if (/(裸体|nude|naked)/i.test(normalized)) {
        return 'revealing pose';
    }

    if (/(penis|vagina|genital|性器官)/i.test(normalized)) {
        return 'intimate body detail';
    }

    if (/(射精|cum|orgasm)/i.test(normalized)) {
        return 'heightened intimacy';
    }

    return 'intimate detail';
}

function sanitizeSourceForPromptApi(text, settings = ensureSettings()) {
    let sanitized = normalizeWhitespace(text);

    if (!settings.nsfw_guard_enabled || !sanitized) {
        return sanitized;
    }

    const sensitiveTerms = parseSensitiveTerms(settings.nsfw_terms);
    let replacedSensitiveTerm = false;

    for (const term of sensitiveTerms) {
        const regex = buildSensitiveTermRegex(term);
        if (!regex) {
            continue;
        }

        const replacement = getSafeSensitiveReplacement(term);
        const updated = sanitized.replace(regex, replacement);

        if (updated !== sanitized) {
            replacedSensitiveTerm = true;
            sanitized = updated;
        }
    }

    sanitized = normalizeWhitespace(sanitized);

    if (replacedSensitiveTerm && !/tasteful|non-explicit|cinematic|platform-safe/i.test(sanitized)) {
        sanitized = normalizeWhitespace(`${sanitized}. Keep the scene tasteful, cinematic, emotionally charged, and non-explicit.`);
    }

    return sanitized;
}

function getPromptAssistantSystemPrompt(settings = ensureSettings()) {
    const configured = String(settings.prompt_api_system_prompt || '').trim();
    return configured || DEFAULT_PROMPT_API_SYSTEM_PROMPT;
}

function getCardDescriptorSystemPrompt(settings = ensureSettings()) {
    const configured = String(settings.descriptor_card_system_prompt || '').trim();
    return configured || DEFAULT_CARD_DESCRIPTOR_SYSTEM_PROMPT;
}

function getPersonaDescriptorSystemPrompt(settings = ensureSettings()) {
    const configured = String(settings.descriptor_persona_system_prompt || '').trim();
    return configured || DEFAULT_PERSONA_DESCRIPTOR_SYSTEM_PROMPT;
}

function buildEffectiveSystemPrompt(basePrompt, runtimeScaffold) {
    return [String(basePrompt || '').trim(), String(runtimeScaffold || '').trim()]
        .filter(Boolean)
        .join('\n\n');
}

function getEffectivePromptAssistantSystemPrompt(settings = ensureSettings()) {
    return buildEffectiveSystemPrompt(getPromptAssistantSystemPrompt(settings), PROMPT_ASSISTANT_RUNTIME_SCAFFOLD);
}

function getEffectiveCardDescriptorSystemPrompt(settings = ensureSettings()) {
    return buildEffectiveSystemPrompt(getCardDescriptorSystemPrompt(settings), CARD_DESCRIPTOR_RUNTIME_SCAFFOLD);
}

function getEffectivePersonaDescriptorSystemPrompt(settings = ensureSettings()) {
    return buildEffectiveSystemPrompt(getPersonaDescriptorSystemPrompt(settings), PERSONA_DESCRIPTOR_RUNTIME_SCAFFOLD);
}

function tryParseJson(text) {
    if (typeof text !== 'string' || !text.trim()) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function getErrorMessageFromPayload(payload) {
    if (!payload) {
        return '';
    }

    if (typeof payload === 'string') {
        return payload.trim();
    }

    if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
        return payload.error.message.trim();
    }

    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        return payload.detail.trim();
    }

    return '';
}

function isSafetyBlockMessage(message) {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('prohibited_content')
        || normalized.includes('request blocked by gemini api')
        || normalized.includes('blocked by gemini')
        || normalized.includes('content_policy')
        || normalized.includes('content policy')
        || normalized.includes('policy_violation')
        || normalized.includes('moderation')
        || normalized.includes('flagged')
        || normalized.includes('unsafe')
        || normalized.includes('safety');
}

function isPromptSafetyBlockMessage(message) {
    return isSafetyBlockMessage(message);
}

function isImageSafetyBlockMessage(message) {
    return isSafetyBlockMessage(message);
}

function buildFriendlyApiErrorMessage(rawMessage, response) {
    const normalized = String(rawMessage || '').trim();

    if (isSafetyBlockMessage(normalized)) {
        return '接口判定当前内容可能过于敏感，已被安全策略拦截。';
    }

    if (normalized) {
        return normalized;
    }

    return `${response.status} ${response.statusText}`.trim();
}

function buildFriendlyFetchFailureMessage(url, error) {
    const normalizedUrl = normalizeUrl(url);
    let resolvedTarget = normalizedUrl;
    let targetProtocol = '';
    let targetHost = '';

    try {
        const parsed = new URL(normalizedUrl, window.location.href);
        resolvedTarget = parsed.toString();
        targetProtocol = parsed.protocol;
        targetHost = parsed.host;
    } catch {
        // ignore URL parsing failures and fall back to the raw value
    }

    const pageProtocol = String(window.location?.protocol || '').toLowerCase();
    const rawMessage = String(error?.message || '').trim();

    if (pageProtocol === 'https:' && targetProtocol === 'http:') {
        return `当前酒馆页面使用 HTTPS，但接口地址是 HTTP（${targetHost || resolvedTarget}），浏览器已拦截该请求。请把接口换成 HTTPS，或通过反向代理/酒馆后端中转。`;
    }

    if (rawMessage && rawMessage !== 'Failed to fetch') {
        return `无法访问接口：${rawMessage}`;
    }

    if (resolvedTarget) {
        return `浏览器无法直接访问接口 ${resolvedTarget}。这通常是混合内容拦截、CORS、证书错误，或目标服务当前不可达导致的。`;
    }

    return '浏览器无法直接访问该接口，请检查接口地址、协议和网络连通性。';
}

function isPromptSafetyBlockError(error) {
    return isPromptSafetyBlockMessage(error?.message || error?.rawMessage || '');
}

function isImageSafetyBlockError(error) {
    return isImageSafetyBlockMessage(error?.message || error?.rawMessage || '');
}

function hasSensitiveTermInText(text, settings = ensureSettings()) {
    const value = String(text || '');
    if (!value) {
        return false;
    }

    return parseSensitiveTerms(settings.nsfw_terms).some(term => {
        const regex = buildSensitiveTermRegex(term);
        return regex ? regex.test(value) : false;
    });
}

function isLikelyImageSafetyHeuristic(error, prompt, settings = ensureSettings()) {
    if (isImageSafetyBlockError(error)) {
        return true;
    }

    if (Number(error?.status) !== 400) {
        return false;
    }

    const rawMessage = String(error?.rawMessage || error?.message || '').trim();
    if (rawMessage) {
        return false;
    }

    return hasSensitiveTermInText(prompt, settings)
        || /(explicit|nude|naked|nipples?|penis|vagina|cum|orgasm|anal|blowjob|nsfw|裸体|露点|性交|性爱|做爱|性器官|射精)/i.test(String(prompt || ''));
}

function buildFallbackPromptFromContext(promptContext) {
    const {
        sanitizedSourceText,
        personaContext,
        personaDescriptor,
    } = promptContext;

    const promptParts = [sanitizeGeneratedPrompt(sanitizedSourceText, promptContext.settings)];
    const anchorEntries = getPromptAnchorEntries(promptContext);

    if (anchorEntries.length) {
        promptParts.push(`character anchors: ${anchorEntries.map(entry => `${entry.name}: ${entry.descriptor}`).join('; ')}`);
    }

    if (personaDescriptor) {
        promptParts.push(`user anchor: ${personaContext?.label || 'User'}: ${personaDescriptor}`);
    }

    promptParts.push('cinematic composition, expressive lighting, high detail, tasteful, non-explicit');

    return normalizeWhitespace(promptParts.filter(Boolean).join(', '));
}

function buildNameMatchRegex(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
        return null;
    }

    const escaped = escapeRegExp(normalized);
    if (!escaped) {
        return null;
    }

    if (/^[A-Za-z0-9 _-]+$/.test(normalized)) {
        return new RegExp(`\\b${escaped}\\b`, 'gi');
    }

    if (normalized.length < 2) {
        return null;
    }

    return new RegExp(escaped, 'giu');
}

function countNameOccurrences(text, name) {
    const normalizedText = String(text || '');
    const regex = buildNameMatchRegex(name);
    if (!normalizedText || !regex) {
        return 0;
    }

    const matches = normalizedText.match(regex);
    return Array.isArray(matches) ? matches.length : 0;
}

function getPromptAnchorEntries(promptContext) {
    const entries = Array.isArray(promptContext?.selectedCardEntries) ? promptContext.selectedCardEntries : [];
    if (!entries.length || entries.length > MAX_PROMPT_CHARACTER_ANCHORS) {
        return [];
    }

    return entries.slice(0, MAX_PROMPT_CHARACTER_ANCHORS);
}

function trimDescriptorForPrompt(text, maxLength = 140) {
    const normalized = normalizeWhitespace(text);
    if (!normalized || normalized.length <= maxLength) {
        return normalized;
    }

    const sliced = normalized.slice(0, maxLength);
    const lastDelimiter = Math.max(
        sliced.lastIndexOf('，'),
        sliced.lastIndexOf(','),
        sliced.lastIndexOf('。'),
        sliced.lastIndexOf(';'),
        sliced.lastIndexOf('；'),
    );

    return (lastDelimiter > 40 ? sliced.slice(0, lastDelimiter) : sliced).trim();
}

function promptMentionsAnyName(prompt, names = []) {
    const normalizedPrompt = String(prompt || '').toLowerCase();
    return names.some(name => {
        const normalizedName = String(name || '').trim().toLowerCase();
        return normalizedName && normalizedPrompt.includes(normalizedName);
    });
}

function buildPromptAnchorSegments(promptContext) {
    const { personaContext, personaDescriptor } = promptContext;
    const segments = [];
    const characterEntries = getPromptAnchorEntries(promptContext);

    if (characterEntries.length) {
        segments.push(
            `Character anchor: ${characterEntries.map(entry => {
                const summary = trimDescriptorForPrompt(entry.descriptor, 140);
                return summary ? `${entry.name}, ${summary}` : entry.name;
            }).join('; ')}`,
        );
    }

    if (personaDescriptor) {
        const summary = trimDescriptorForPrompt(personaDescriptor, 120);
        const label = String(personaContext?.label || 'User').trim() || 'User';
        segments.push(summary ? `User anchor: ${label}, ${summary}` : `User anchor: ${label}`);
    }

    return segments;
}

function mergePromptWithAnchors(prompt, promptContext) {
    const finalPrompt = sanitizeGeneratedPrompt(prompt, promptContext.settings);
    if (!finalPrompt) {
        return finalPrompt;
    }

    if (/character anchors?:|user anchor:/i.test(finalPrompt)) {
        return finalPrompt;
    }

    const segments = [];
    const characterEntries = getPromptAnchorEntries(promptContext);
    const missingCharacterEntries = characterEntries.filter(entry => {
        const names = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
        return !promptMentionsAnyName(finalPrompt, names);
    });

    if (missingCharacterEntries.length) {
        segments.push(
            `Character anchor: ${missingCharacterEntries.map(entry => {
                const summary = trimDescriptorForPrompt(entry.descriptor, 140);
                return summary ? `${entry.name}, ${summary}` : entry.name;
            }).join('; ')}`,
        );
    }

    if (promptContext.personaDescriptor) {
        const personaLabel = String(promptContext.personaContext?.label || 'User').trim() || 'User';
        if (!promptMentionsAnyName(finalPrompt, [personaLabel])) {
            const summary = trimDescriptorForPrompt(promptContext.personaDescriptor, 120);
            segments.push(summary ? `User anchor: ${personaLabel}, ${summary}` : `User anchor: ${personaLabel}`);
        }
    }

    if (!segments.length) {
        return finalPrompt;
    }

    return sanitizeGeneratedPrompt(
        normalizeWhitespace(`${segments.join(' ; ')}. ${finalPrompt}`),
        promptContext.settings,
    );
}

function ensureDescriptorLibrary(settings = ensureSettings()) {
    const library = settings.descriptor_library && typeof settings.descriptor_library === 'object'
        ? settings.descriptor_library
        : {};

    library.cards = library.cards && typeof library.cards === 'object' ? library.cards : {};
    library.personas = library.personas && typeof library.personas === 'object' ? library.personas : {};
    settings.descriptor_library = library;
    return library;
}

function normalizeLibraryEntry(entry) {
    const name = String(entry?.name || '').trim();
    const descriptor = normalizeWhitespace(entry?.descriptor || '');

    if (!name || !descriptor) {
        return null;
    }

    return {
        name,
        aliases: uniqueStrings(Array.isArray(entry?.aliases) ? entry.aliases : []),
        descriptor,
        notes: normalizeWhitespace(entry?.notes || ''),
        updatedAt: Date.now(),
    };
}

function normalizeLibraryEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    const seen = new Set();
    const result = [];

    for (const entry of entries) {
        const normalized = normalizeLibraryEntry(entry);
        if (!normalized) {
            continue;
        }

        const dedupeKey = `${normalized.name.toLowerCase()}::${normalized.descriptor.toLowerCase()}`;
        if (seen.has(dedupeKey)) {
            continue;
        }

        seen.add(dedupeKey);
        result.push(normalized);
    }

    return result;
}

function buildCardSourceText(fields) {
    const sections = [
        ['Description', fields?.description],
        ['Personality', fields?.personality],
        ['Scenario', fields?.scenario],
        ['Examples', fields?.mesExamples],
        ['Creator Notes', fields?.creatorNotes],
        ['Character Depth Prompt', fields?.charDepthPrompt],
        ['Persona', fields?.persona],
        ['System', fields?.system],
    ];

    return sections
        .filter(([, value]) => String(value || '').trim())
        .map(([label, value]) => `${label}:\n${String(value).trim()}`)
        .join('\n\n')
        .slice(0, 16000);
}

function hasMeaningfulCardFields(fields) {
    if (!fields || typeof fields !== 'object') {
        return false;
    }

    return [
        fields.system,
        fields.mesExamples,
        fields.description,
        fields.personality,
        fields.persona,
        fields.scenario,
        fields.jailbreak,
        fields.version,
        fields.charDepthPrompt,
        fields.creatorNotes,
    ].some(value => String(value || '').trim().length > 0);
}

function buildMemberCardSourceText(character, context) {
    if (!character) {
        return '';
    }

    const parts = [];
    const name = String(character?.name || '').trim();
    const description = String(character?.description || '').trim();
    const personality = String(character?.personality || '').trim();
    const scenario = String(context.chatMetadata?.scenario || character?.scenario || '').trim();
    const mesExamples = String(character?.mes_example || '').trim();
    const creatorNotes = String(character?.data?.creator_notes || '').trim();
    const depthPrompt = String(character?.data?.extensions?.depth_prompt?.prompt || '').trim();
    const systemPrompt = String(character?.data?.system_prompt || '').trim();

    if (name) parts.push(`Name: ${name}`);
    if (description) parts.push(`Description:\n${description}`);
    if (personality) parts.push(`Personality:\n${personality}`);
    if (scenario) parts.push(`Scenario:\n${scenario}`);
    if (mesExamples) parts.push(`Examples:\n${mesExamples}`);
    if (creatorNotes) parts.push(`Creator Notes:\n${creatorNotes}`);
    if (depthPrompt) parts.push(`Character Depth Prompt:\n${depthPrompt}`);
    if (systemPrompt) parts.push(`System:\n${systemPrompt}`);

    return parts.join('\n\n').trim();
}

function buildFallbackCardFields(context = getContext(), hasGroup = false) {
    const fields = {
        system: '',
        mesExamples: '',
        description: '',
        personality: '',
        persona: String(context.powerUserSettings?.persona_description || '').trim(),
        scenario: '',
        jailbreak: '',
        version: '',
        charDepthPrompt: '',
        creatorNotes: '',
    };

    const characters = getCurrentCardCharacterRecords(context);
    if (!characters.length) {
        return fields;
    }

    if (hasGroup && context.groupId) {
        const groupFields = getGroupCharacterCards(String(context.groupId), Number.isInteger(context.characterId) ? Number(context.characterId) : -1);
        if (groupFields) {
            fields.description = String(groupFields.description || '').trim();
            fields.personality = String(groupFields.personality || '').trim();
            fields.scenario = String(groupFields.scenario || '').trim();
            fields.mesExamples = String(groupFields.mesExamples || '').trim();
        }
    }

    if (!String(fields.description || fields.personality || fields.scenario || fields.mesExamples).trim()) {
        const memberBlocks = characters
            .map(character => buildMemberCardSourceText(character, context))
            .filter(Boolean);
        fields.description = memberBlocks.join('\n\n---\n\n').slice(0, 16000);
    }

    fields.creatorNotes = uniqueStrings(characters.map(character => character?.data?.creator_notes)).join('\n\n');
    fields.charDepthPrompt = uniqueStrings(characters.map(character => character?.data?.extensions?.depth_prompt?.prompt)).join('\n\n');
    fields.system = uniqueStrings(characters.map(character => character?.data?.system_prompt)).join('\n\n');
    fields.version = uniqueStrings(characters.map(character => character?.data?.character_version)).join(', ');

    return fields;
}

function buildCardContextDebugSummary() {
    const context = getContext();
    const hasCharacter = Number.isInteger(context.characterId) || /^\d+$/.test(String(context.characterId ?? ''));
    const hasGroup = context.groupId !== null && typeof context.groupId !== 'undefined' && String(context.groupId) !== '';
    const nativeFields = context.getCharacterCardFields({ chid: hasCharacter ? Number(context.characterId) : null });
    const matchedCharacters = getCurrentCardCharacterRecords(context);

    return [
        `chid=${String(context.characterId ?? 'null')}`,
        `gid=${String(context.groupId ?? 'null')}`,
        `原生字段=${hasMeaningfulCardFields(nativeFields) ? '有' : '空'}`,
        `匹配角色=${matchedCharacters.length}`,
        `chat=${Array.isArray(context.chat) ? context.chat.length : 0}`,
        hasGroup ? '群聊=是' : '群聊=否',
    ].join(' · ');
}

function getCurrentCardContext() {
    const context = getContext();
    const hasCharacter = Number.isInteger(context.characterId) || /^\d+$/.test(String(context.characterId ?? ''));
    const hasGroup = context.groupId !== null && typeof context.groupId !== 'undefined' && String(context.groupId) !== '';

    if (!hasCharacter && !hasGroup) {
        return null;
    }

    let fields = context.getCharacterCardFields({ chid: hasCharacter ? Number(context.characterId) : null });
    let detectionMode = hasGroup ? 'group-native' : 'character-native';

    if (!hasMeaningfulCardFields(fields)) {
        const fallbackFields = buildFallbackCardFields(context, hasGroup);
        if (hasMeaningfulCardFields(fallbackFields)) {
            fields = fallbackFields;
            detectionMode = hasGroup ? 'group-fallback' : 'character-fallback';
        }
    }

    const sourceText = buildCardSourceText(fields);
    if (!sourceText) {
        return null;
    }

    if (hasGroup) {
        const group = Array.isArray(context.groups)
            ? context.groups.find(item => String(item?.id) === String(context.groupId))
            : null;

        return {
            key: `group:${context.groupId}`,
            label: String(group?.name || context.name2 || '当前群聊角色卡').trim(),
            type: 'group',
            fields,
            sourceText,
            detectionMode,
        };
    }

    const character = Array.isArray(context.characters) ? context.characters[Number(context.characterId)] : null;
    const characterKey = character?.avatar || character?.name || context.name2 || context.characterId;

    return {
        key: `char:${characterKey}`,
        label: String(character?.name || context.name2 || '当前角色卡').trim(),
        type: 'character',
        fields,
        sourceText,
        detectionMode,
    };
}

function getCurrentPersonaContext() {
    const context = getContext();
    const powerUser = context.powerUserSettings || {};
    const avatarId = String(user_avatar || powerUser.default_persona || 'default');
    const personaLabel = String(powerUser.personas?.[avatarId] || context.name1 || '当前用户').trim();
    const sourceDescription = String(powerUser.persona_descriptions?.[avatarId]?.description || powerUser.persona_description || '').trim();

    return {
        key: `persona:${avatarId || personaLabel || 'default'}`,
        label: personaLabel || '当前用户',
        avatarId,
        sourceDescription,
    };
}

function getCurrentCharacterRecord() {
    const context = getContext();
    const hasCharacter = Number.isInteger(context.characterId) || /^\d+$/.test(String(context.characterId ?? ''));
    return hasCharacter ? context.characters?.[Number(context.characterId)] || null : null;
}

function getCharacterAvatarKey(character) {
    return String(character?.avatar || '').replace(/\.[^/.]+$/, '').trim();
}

function getCurrentCardCharacterRecords(context = getContext()) {
    const records = [];
    const seen = new Set();

    function pushCharacter(character) {
        if (!character) {
            return;
        }

        const key = String(getCharacterAvatarKey(character) || character?.name || '').trim().toLowerCase();
        if (!key || seen.has(key)) {
            return;
        }

        seen.add(key);
        records.push(character);
    }

    const hasCharacter = Number.isInteger(context.characterId) || /^\d+$/.test(String(context.characterId ?? ''));
    const hasGroup = context.groupId !== null && typeof context.groupId !== 'undefined' && String(context.groupId) !== '';

    if (hasCharacter) {
        pushCharacter(context.characters?.[Number(context.characterId)] || null);
    }

    if (hasGroup) {
        const group = Array.isArray(context.groups)
            ? context.groups.find(item => String(item?.id) === String(context.groupId))
            : null;
        const members = Array.isArray(group?.members) ? group.members : [];

        for (const member of members) {
            const memberRef = String(member || '').trim();
            const memberAvatarKey = memberRef.replace(/\.[^/.]+$/, '').trim().toLowerCase();
            if (!memberAvatarKey) {
                continue;
            }

            const character = Array.isArray(context.characters)
                ? context.characters.find(item => {
                    const avatar = String(item?.avatar || '').trim();
                    const avatarKey = getCharacterAvatarKey(item).toLowerCase();
                    const name = String(item?.name || '').trim().toLowerCase();
                    return avatar === memberRef || avatarKey === memberAvatarKey || name === memberAvatarKey;
                })
                : null;

            pushCharacter(character || null);
        }
    }

    return records;
}

function getBookEntriesList(book) {
    if (Array.isArray(book?.entries)) {
        return book.entries.filter(Boolean);
    }

    if (book?.entries && typeof book.entries === 'object') {
        return Object.values(book.entries).filter(Boolean);
    }

    return [];
}

function formatWorldInfoEntries(entries, { maxEntries = 64, maxChars = 12000, includeWorldLabel = false } = {}) {
    const chunks = [];
    let totalLength = 0;

    for (const entry of entries) {
        if (chunks.length >= maxEntries) {
            break;
        }

        if (!entry || entry.disable === true || entry.enabled === false) {
            continue;
        }

        const parts = [];
        const comment = String(entry.comment || '').trim();
        const content = String(entry.content || '').trim();
        const worldLabel = String(entry.world || '').trim();
        const primaryKeys = Array.isArray(entry.key) ? entry.key.filter(Boolean) : [];
        const secondaryKeys = Array.isArray(entry.keysecondary) ? entry.keysecondary.filter(Boolean) : [];

        if (!comment && !content && !primaryKeys.length && !secondaryKeys.length) {
            continue;
        }

        if (includeWorldLabel && worldLabel) {
            parts.push(`World: ${worldLabel}`);
        }

        if (comment) {
            parts.push(`Comment: ${comment}`);
        }

        if (primaryKeys.length) {
            parts.push(`Keys: ${primaryKeys.join(', ')}`);
        }

        if (secondaryKeys.length) {
            parts.push(`Secondary Keys: ${secondaryKeys.join(', ')}`);
        }

        if (content) {
            parts.push(`Content:\n${content}`);
        }

        const chunk = parts.join('\n').trim();
        if (!chunk) {
            continue;
        }

        if (totalLength + chunk.length > maxChars && chunks.length > 0) {
            break;
        }

        chunks.push(`- Entry ${chunks.length + 1}\n${chunk}`);
        totalLength += chunk.length;
    }

    return chunks.join('\n\n');
}

function buildEmbeddedCharacterBookSourceText(character) {
    const book = character?.data?.character_book;
    if (!book) {
        return '';
    }

    const entriesText = formatWorldInfoEntries(getBookEntriesList(book), {
        maxEntries: 48,
        maxChars: 10000,
    });

    if (!entriesText) {
        return '';
    }

    return [
        `Embedded character book: ${String(book.name || character?.name || 'Character Book').trim()}`,
        entriesText,
    ].join('\n\n');
}

function buildEmbeddedCharacterBookSourceBlocks(characters) {
    return characters
        .map(character => buildEmbeddedCharacterBookSourceText(character))
        .filter(Boolean);
}

function getCharacterBoundWorldNames(character) {
    const names = [];
    const primaryWorld = String(character?.data?.extensions?.world || '').trim();
    const avatarKey = getCharacterAvatarKey(character);
    const extraWorlds = avatarKey
        ? world_info.charLore?.find(item => String(item?.name || '').trim() === avatarKey)?.extraBooks
        : [];

    if (primaryWorld) {
        names.push(primaryWorld);
    }

    if (Array.isArray(extraWorlds)) {
        names.push(...extraWorlds);
    }

    return uniqueStrings(names);
}

function getCardWorldBookNames(cardContext, context = getContext()) {
    const names = [];
    const chatWorld = String(context.chatMetadata?.world_info || '').trim();

    for (const character of getCurrentCardCharacterRecords(context)) {
        names.push(...getCharacterBoundWorldNames(character));
    }

    if (chatWorld) {
        names.push(chatWorld);
    }

    if (Array.isArray(selected_world_info)) {
        names.push(...selected_world_info);
    }

    return uniqueStrings(names);
}

async function loadWorldBookSourceBlocks(bookNames, context = getContext(), { maxEntries = 48, maxChars = 9000 } = {}) {
    const blocks = [];

    for (const bookName of uniqueStrings(bookNames)) {
        try {
            const data = await context.loadWorldInfo(bookName);
            const entriesText = formatWorldInfoEntries(getBookEntriesList(data), {
                maxEntries,
                maxChars,
            });

            if (!entriesText) {
                continue;
            }

            blocks.push([
                `World lorebook: ${bookName}`,
                entriesText,
            ].join('\n\n'));
        } catch (error) {
            console.warn('Failed to load world lorebook for descriptor extraction', bookName, error);
        }
    }

    return blocks;
}

function buildWorldInfoScanMessages(context = getContext()) {
    const chatMessages = Array.isArray(context.chat) ? context.chat : [];

    return chatMessages
        .filter(message => message && (!message.is_system || Array.isArray(message.extra?.tool_invocations)))
        .map(message => {
            const mes = String(message?.mes || '').trim();
            if (!mes) {
                return '';
            }

            if (world_info_include_names) {
                const name = String(message?.name || '').trim();
                return name ? `${name}: ${mes}` : mes;
            }

            return mes;
        })
        .filter(Boolean)
        .reverse();
}

function buildWorldInfoGlobalScanData(cardContext, personaContext) {
    const fields = cardContext?.fields || {};

    return {
        personaDescription: String(personaContext?.sourceDescription || fields?.persona || '').trim(),
        characterDescription: String(fields?.description || '').trim(),
        characterPersonality: String(fields?.personality || '').trim(),
        characterDepthPrompt: String(fields?.charDepthPrompt || '').trim(),
        scenario: String(fields?.scenario || '').trim(),
        creatorNotes: String(fields?.creatorNotes || '').trim(),
        trigger: 'normal',
    };
}

function getCollectionValues(collection) {
    if (collection instanceof Map || collection instanceof Set) {
        return Array.from(collection.values());
    }

    if (Array.isArray(collection)) {
        return collection;
    }

    return [];
}

function filterWorldInfoEntriesByWorld(entries, worldNames) {
    const allowed = new Set(uniqueStrings(worldNames).map(name => name.toLowerCase()));
    if (!allowed.size) {
        return [];
    }

    return entries.filter(entry => allowed.has(String(entry?.world || '').trim().toLowerCase()));
}

function restoreExtensionPromptSnapshot(context, key, snapshot) {
    if (!key || !snapshot) {
        return;
    }

    context.setExtensionPrompt(
        key,
        snapshot.value || '',
        snapshot.position ?? 0,
        snapshot.depth ?? 0,
        snapshot.scan ?? false,
        snapshot.role ?? 0,
        snapshot.filter ?? null,
    );
}

async function getActivatedWorldInfoEntries(cardContext, personaContext, context = getContext()) {
    const scanMessages = buildWorldInfoScanMessages(context);
    if (!scanMessages.length) {
        return [];
    }

    const notePromptSnapshot = context.extensionPrompts?.[NOTE_MODULE_NAME]
        ? { ...context.extensionPrompts[NOTE_MODULE_NAME] }
        : null;

    try {
        const result = await checkWorldInfo(
            scanMessages,
            Number(context.maxContext) || 4096,
            true,
            buildWorldInfoGlobalScanData(cardContext, personaContext),
        );

        return getCollectionValues(result?.allActivatedEntries).filter(Boolean);
    } catch (error) {
        console.warn('Failed to scan active world info for descriptor extraction', error);
        return [];
    } finally {
        restoreExtensionPromptSnapshot(context, NOTE_MODULE_NAME, notePromptSnapshot);
    }
}

async function buildActivatedLoreSourceBlock({
    cardContext = null,
    personaContext = null,
    relevantWorldNames = [],
    context = getContext(),
    preferredLabel = '',
} = {}) {
    const activatedEntries = await getActivatedWorldInfoEntries(cardContext, personaContext, context);
    if (!activatedEntries.length) {
        return '';
    }

    const matchingEntries = filterWorldInfoEntriesByWorld(activatedEntries, relevantWorldNames);
    const chosenEntries = matchingEntries.length ? matchingEntries : activatedEntries;
    const entriesText = formatWorldInfoEntries(chosenEntries, {
        maxEntries: 24,
        maxChars: 7000,
        includeWorldLabel: true,
    });

    if (!entriesText) {
        return '';
    }

    const label = preferredLabel || (matchingEntries.length
        ? 'Context-matched active lore entries from the current relevant lorebooks:'
        : 'Context-matched active lore entries from the current chat scan:');

    return [
        label,
        entriesText,
    ].join('\n\n');
}

async function buildCardDescriptorExtractionSource(cardContext) {
    const context = getContext();
    const characters = getCurrentCardCharacterRecords(context);
    const sections = [];

    if (cardContext?.sourceText) {
        sections.push(`Character card source:\n${cardContext.sourceText}`);
    }

    const embeddedCharacterBooks = buildEmbeddedCharacterBookSourceBlocks(characters);
    if (embeddedCharacterBooks.length) {
        sections.push(embeddedCharacterBooks.join('\n\n'));
    }

    const relevantWorldNames = getCardWorldBookNames(cardContext, context);
    const activatedLoreBlock = await buildActivatedLoreSourceBlock({
        cardContext,
        personaContext: getCurrentPersonaContext(),
        relevantWorldNames,
        context,
        preferredLabel: 'Context-matched active lore entries for the current card:',
    });
    if (activatedLoreBlock) {
        sections.push(activatedLoreBlock);
    }

    const worldBlocks = await loadWorldBookSourceBlocks(relevantWorldNames, context, {
        maxEntries: activatedLoreBlock ? 24 : 48,
        maxChars: activatedLoreBlock ? 4500 : 9000,
    });
    if (worldBlocks.length) {
        sections.push(worldBlocks.join('\n\n'));
    }

    return sections.join('\n\n').slice(0, 32000);
}

function getPersonaLorebookNames(personaContext, context = getContext()) {
    const powerUser = context.powerUserSettings || {};
    const personaRecord = powerUser.persona_descriptions?.[personaContext?.avatarId] || {};

    return uniqueStrings([
        personaRecord?.lorebook,
        powerUser.persona_description_lorebook,
    ]);
}

async function buildPersonaDescriptorExtractionSource(personaContext) {
    const context = getContext();
    const sections = [];

    if (personaContext?.sourceDescription) {
        sections.push(`Persona source:\n${personaContext.sourceDescription}`);
    }

    const relevantWorldNames = getPersonaLorebookNames(personaContext, context);
    const activatedLoreBlock = await buildActivatedLoreSourceBlock({
        cardContext: getCurrentCardContext(),
        personaContext,
        relevantWorldNames,
        context,
        preferredLabel: 'Context-matched active lore entries for the current persona:',
    });
    if (activatedLoreBlock) {
        sections.push(activatedLoreBlock);
    }

    const worldBlocks = await loadWorldBookSourceBlocks(relevantWorldNames, context, {
        maxEntries: activatedLoreBlock ? 24 : 48,
        maxChars: activatedLoreBlock ? 3500 : 9000,
    });
    if (worldBlocks.length) {
        sections.push(worldBlocks.join('\n\n'));
    }

    return sections.join('\n\n').slice(0, 24000);
}

function getCardLibraryRecord(cardContext) {
    if (!cardContext) {
        return null;
    }

    return ensureDescriptorLibrary().cards[cardContext.key] || null;
}

function getPersonaLibraryRecord(personaContext) {
    if (!personaContext) {
        return null;
    }

    return ensureDescriptorLibrary().personas[personaContext.key] || null;
}

function saveCardLibraryRecord(cardContext, entries) {
    if (!cardContext) {
        throw new Error('当前没有可用的角色卡。');
    }

    const normalizedEntries = normalizeLibraryEntries(entries);
    const library = ensureDescriptorLibrary();
    library.cards[cardContext.key] = {
        key: cardContext.key,
        label: cardContext.label,
        type: cardContext.type,
        entries: normalizedEntries,
        updatedAt: Date.now(),
    };
}

function savePersonaLibraryRecord(personaContext, descriptor) {
    if (!personaContext) {
        throw new Error('当前没有可用的人设。');
    }

    const library = ensureDescriptorLibrary();
    library.personas[personaContext.key] = {
        key: personaContext.key,
        label: personaContext.label,
        avatarId: personaContext.avatarId,
        sourceDescription: personaContext.sourceDescription,
        descriptor: normalizeWhitespace(descriptor),
        updatedAt: Date.now(),
    };
}

function deleteCardLibraryRecord(cardContext) {
    if (!cardContext) {
        return;
    }

    delete ensureDescriptorLibrary().cards[cardContext.key];
}

function deletePersonaLibraryRecord(personaContext) {
    if (!personaContext) {
        return;
    }

    delete ensureDescriptorLibrary().personas[personaContext.key];
}

function serializeLibraryEntries(entries) {
    return JSON.stringify(normalizeLibraryEntries(entries), null, 2);
}

function extractJsonPayload(rawText) {
    const text = String(rawText || '').trim();

    if (!text) {
        throw new Error('提取接口没有返回内容。');
    }

    const tryParse = candidate => {
        try {
            return JSON.parse(candidate);
        } catch {
            return null;
        }
    };

    const direct = tryParse(text);
    if (direct !== null) {
        return direct;
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        const parsed = tryParse(fenced[1].trim());
        if (parsed !== null) {
            return parsed;
        }
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd > objectStart) {
        const parsed = tryParse(text.slice(objectStart, objectEnd + 1));
        if (parsed !== null) {
            return parsed;
        }
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
        const parsed = tryParse(text.slice(arrayStart, arrayEnd + 1));
        if (parsed !== null) {
            return parsed;
        }
    }

    throw new Error('提取接口返回的 JSON 无法解析。');
}

function stripHtml(rawText) {
    const text = String(rawText || '');
    const withoutComments = text.replace(/<!--[\s\S]*?-->/g, ' ');
    const withoutMediaTags = withoutComments
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/<audio\b[\s\S]*?<\/audio>/gi, ' ')
        .replace(/<video\b[\s\S]*?<\/video>/gi, ' ')
        .replace(/<source\b[^>]*>/gi, ' ');

    const container = document.createElement('div');
    container.innerHTML = withoutMediaTags;

    return (container.textContent || container.innerText || '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function getPlainMessageText(message) {
    return stripHtml(message?.extra?.display_text ?? message?.mes);
}

function isRenderableAssistantMessage(message) {
    return Boolean(
        message &&
        !message.is_user &&
        !message.is_system &&
        !message.extra?.chatgpt2api_image &&
        typeof message.mes === 'string' &&
        getPlainMessageText(message),
    );
}

function getMessageById(messageId) {
    const context = getContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const index = normalizeMessageId(messageId);
    const message = index !== null ? chat[index] : null;
    return isRenderableAssistantMessage(message) ? message : null;
}

function getLatestAssistantMessageEntry() {
    const context = getContext();
    const chat = Array.isArray(context.chat) ? context.chat : [];

    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];
        if (isRenderableAssistantMessage(message)) {
            return { messageId: index, message };
        }
    }

    return null;
}

function getPromptFromPayload(payload) {
    if (typeof payload === 'string') {
        return payload.trim();
    }

    if (Array.isArray(payload?.choices?.[0]?.message?.content)) {
        const content = payload.choices[0].message.content
            .map(part => {
                if (typeof part === 'string') {
                    return part;
                }

                if (typeof part?.text === 'string') {
                    return part.text;
                }

                return '';
            })
            .join('\n')
            .trim();

        if (content) {
            return content;
        }
    }

    const candidates = [
        payload?.prompt,
        payload?.data?.prompt,
        payload?.result?.prompt,
        payload?.output?.prompt,
        payload?.output_text,
        payload?.response,
        payload?.choices?.[0]?.message?.content,
        payload?.choices?.[0]?.text,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    if (Array.isArray(payload?.prompts)) {
        const firstPrompt = payload.prompts.find(item => typeof item === 'string' && item.trim());
        if (firstPrompt) {
            return firstPrompt.trim();
        }
    }

    return '';
}

async function fetchJsonOrText(url, options) {
    let response;

    try {
        response = await fetch(url, options);
    } catch (error) {
        const wrappedError = new Error(buildFriendlyFetchFailureMessage(url, error));
        wrappedError.cause = error;
        wrappedError.url = url;
        wrappedError.isNetworkError = true;
        throw wrappedError;
    }

    const text = await response.text();

    if (!response.ok) {
        const parsedPayload = tryParseJson(text);
        const rawMessage = getErrorMessageFromPayload(parsedPayload) || text;
        const error = new Error(buildFriendlyApiErrorMessage(rawMessage, response));
        error.status = response.status;
        error.payload = parsedPayload;
        error.rawMessage = rawMessage;
        error.responseText = text;
        error.url = url;
        throw error;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function buildPromptLegacy(sourceMessage) {
    const settings = ensureSettings();
    const latestMessageText = getPlainMessageText(sourceMessage);

    if (!latestMessageText) {
        throw new Error('清理后的 AI 消息正文为空。');
    }

    if (!settings.prompt_api_enabled || !normalizeUrl(settings.prompt_api_url)) {
        return latestMessageText;
    }

    if (settings.prompt_api_mode === 'openai') {
        return await buildPromptWithOpenAiCompatibleApi(settings, latestMessageText, sourceMessage);
    }

    return await buildPromptWithCustomApi(settings, latestMessageText, sourceMessage);
}

function getPromptApiChatCompletionsUrl(settings) {
    return buildOpenAiCompatibleEndpointUrl(settings.prompt_api_url, '/chat/completions');
}

async function buildPromptWithOpenAiCompatibleApi(settings, latestMessageText, sourceMessage) {
    const model = String(settings.prompt_api_model || '').trim();

    if (!model) {
        throw new Error('提示词模型不能为空。');
    }

    const headers = {
        'Content-Type': 'application/json',
    };

    if (settings.prompt_api_key.trim()) {
        headers.Authorization = `Bearer ${settings.prompt_api_key.trim()}`;
    }

    const payload = {
        model,
        messages: [
            {
                role: 'system',
                content: 'You convert the selected AI roleplay reply into one concise image generation prompt. Keep visual details, preserve mood, and output only the final prompt text.',
            },
            {
                role: 'user',
                content: [
                    `Character: ${sourceMessage?.name || ''}`,
                    'Selected AI message:',
                    latestMessageText,
                ].join('\n'),
            },
        ],
        temperature: 0.7,
        stream: false,
    };

    const result = await fetchJsonOrText(getPromptApiChatCompletionsUrl(settings), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    const prompt = getPromptFromPayload(result);

    if (!prompt) {
        throw new Error('提示词接口没有返回可用的提示词。');
    }

    return prompt;
}

async function buildPromptWithCustomApi(settings, latestMessageText, sourceMessage) {
    const headers = {
        'Content-Type': 'application/json',
    };

    if (settings.prompt_api_key.trim()) {
        headers.Authorization = `Bearer ${settings.prompt_api_key.trim()}`;
    }

    const payload = {
        message: latestMessageText,
        raw_message: String(sourceMessage.mes || ''),
        character_name: sourceMessage.name || '',
        message_id: Array.isArray(getContext().chat) ? getContext().chat.indexOf(sourceMessage) : -1,
    };

    const result = await fetchJsonOrText(normalizeUrl(settings.prompt_api_url), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    const prompt = getPromptFromPayload(result);

    if (!prompt) {
        throw new Error('提示词接口没有返回可用的提示词。');
    }

    return prompt;
}

function getPromptApiModelsUrl(settings) {
    return buildOpenAiCompatibleEndpointUrl(settings.prompt_api_url, '/models');
}

function getPromptApiHeaders(settings, { includeContentType = true } = {}) {
    const headers = includeContentType
        ? { 'Content-Type': 'application/json' }
        : {};

    if (String(settings.prompt_api_key || '').trim()) {
        headers.Authorization = `Bearer ${String(settings.prompt_api_key).trim()}`;
    }

    return headers;
}

async function requestPromptApiChatCompletionViaSillyTavern(settings, messages, { temperature = 0.4 } = {}) {
    const model = String(settings.prompt_api_model || '').trim();

    if (!model) {
        throw new Error('提示词模型不能为空。');
    }

    return await fetchJsonOrText('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            stream: false,
            chat_completion_source: 'openai',
            reverse_proxy: normalizeUrl(settings.prompt_api_url),
            proxy_password: String(settings.prompt_api_key || '').trim(),
            model,
            messages,
            temperature,
        }),
    });
}

async function requestPromptApiModelsViaSillyTavern(settings) {
    return await fetchJsonOrText('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            chat_completion_source: 'openai',
            reverse_proxy: normalizeUrl(settings.prompt_api_url),
            proxy_password: String(settings.prompt_api_key || '').trim(),
        }),
    });
}

function extractPromptApiModelIds(result) {
    const candidateCollections = [
        result,
        result?.data,
        result?.data?.data,
        result?.models,
        result?.data?.models,
        result?.value,
        result?.result,
        result?.items,
        result?.list,
        result?.model_ids,
    ];

    return uniqueStrings(candidateCollections.flatMap(collection => {
        if (!Array.isArray(collection)) {
            return [];
        }

        return collection.flatMap(item => {
            if (typeof item === 'string') {
                return item;
            }

            if (!item || typeof item !== 'object') {
                return [];
            }

            return [
                item.id,
                item.name,
                item.model,
                item.model_id,
            ].filter(value => typeof value === 'string' && String(value).trim());
        });
    }));
}

function getCardLibraryEntries(cardContext) {
    return normalizeLibraryEntries(getCardLibraryRecord(cardContext)?.entries || []);
}

function getRawTextFromPromptPayload(payload) {
    return getPromptFromPayload(payload);
}

function normalizeSceneCastAnalysis(payload) {
    const presentCharacters = uniqueStrings(
        Array.isArray(payload?.present_characters)
            ? payload.present_characters.map(item => typeof item === 'string' ? item : item?.name || item?.label || item?.character || '')
            : [],
    );

    const mentionedButAbsent = uniqueStrings(
        Array.isArray(payload?.mentioned_but_absent)
            ? payload.mentioned_but_absent.map(item => typeof item === 'string' ? item : item?.name || item?.label || item?.character || '')
            : [],
    );

    return {
        presentCharacters,
        mentionedButAbsent,
        interactionSummary: normalizeWhitespace(payload?.interaction_summary || payload?.interaction || ''),
        shouldInjectDescriptors: payload?.should_inject_descriptors !== false && presentCharacters.length > 0 && presentCharacters.length <= MAX_PROMPT_CHARACTER_ANCHORS,
    };
}

function findDescriptorEntryByName(entries, candidateName) {
    const normalizedCandidate = String(candidateName || '').trim().toLowerCase();
    if (!normalizedCandidate) {
        return null;
    }

    const exact = entries.find(entry => {
        const names = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
        return names.some(name => String(name || '').trim().toLowerCase() === normalizedCandidate);
    });
    if (exact) {
        return exact;
    }

    return entries.find(entry => {
        const names = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
        return names.some(name => {
            const normalizedName = String(name || '').trim().toLowerCase();
            return normalizedName && (normalizedCandidate.includes(normalizedName) || normalizedName.includes(normalizedCandidate));
        });
    }) || null;
}

function selectSceneEntriesFromAnalysis(entries, sceneCastAnalysis) {
    if (!sceneCastAnalysis?.shouldInjectDescriptors) {
        return [];
    }

    const selected = [];
    const seen = new Set();

    for (const name of sceneCastAnalysis.presentCharacters) {
        const entry = findDescriptorEntryByName(entries, name);
        if (!entry) {
            continue;
        }

        const key = `${String(entry.name || '').trim().toLowerCase()}::${String(entry.descriptor || '').trim().toLowerCase()}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        selected.push(entry);

        if (selected.length >= MAX_PROMPT_CHARACTER_ANCHORS) {
            break;
        }
    }

    return selected;
}

function buildSceneCastAnalysisMessages(promptContext) {
    const { sourceMessage, latestMessageText, sanitizedSourceText, cardContext, cardLibraryEntries } = promptContext;
    const descriptorLines = cardLibraryEntries.length
        ? cardLibraryEntries.map(entry => {
            const aliases = Array.isArray(entry.aliases) && entry.aliases.length
                ? ` | aliases: ${entry.aliases.join(', ')}`
                : '';
            return `- ${entry.name}${aliases} | descriptor: ${trimDescriptorForPrompt(entry.descriptor, 180)}`;
        }).join('\n')
        : '- none';

    const sections = [
        `Current assistant speaker: ${sourceMessage?.name || ''}`,
        `Current card: ${cardContext?.label || ''} (${cardContext?.type || 'unknown'})`,
        `Visible scene text:\n${sanitizedSourceText || latestMessageText}`,
        `Descriptor-library characters:\n${descriptorLines}`,
        'Decide who is physically present in the current visible scene right now, who is only mentioned or off-screen, and summarize the main visible interaction.',
    ];

    return [
        {
            role: 'system',
            content: DEFAULT_SCENE_CAST_ANALYSIS_SYSTEM_PROMPT,
        },
        {
            role: 'user',
            content: sections.join('\n\n'),
        },
    ];
}

async function analyzeSceneCastWithOpenAi(settings, promptContext) {
    if (!promptContext.cardLibraryEntries.length) {
        return {
            presentCharacters: [],
            mentionedButAbsent: [],
            interactionSummary: '',
            shouldInjectDescriptors: false,
        };
    }

    const result = await requestPromptApiChatCompletion(settings, buildSceneCastAnalysisMessages(promptContext), {
        temperature: 0.1,
    });
    const rawText = getRawTextFromPromptPayload(result);
    const payload = extractJsonPayload(rawText);
    return normalizeSceneCastAnalysis(payload);
}

async function buildPromptGenerationContext(sourceMessage, latestMessageText) {
    const settings = ensureSettings();
    const cardContext = getCurrentCardContext();
    const personaContext = getCurrentPersonaContext();
    const personaRecord = getPersonaLibraryRecord(personaContext);
    const sanitizedSourceText = sanitizeSourceForPromptApi(latestMessageText, settings);
    const cardLibraryEntries = getCardLibraryEntries(cardContext);

    const promptContext = {
        settings,
        latestMessageText,
        sanitizedSourceText,
        sourceMessage,
        cardContext,
        cardLibraryEntries,
        selectedCardEntries: [],
        sceneCastAnalysis: null,
        sceneInteractionSummary: '',
        personaContext,
        personaDescriptor: normalizeWhitespace(personaRecord?.descriptor || ''),
        sensitiveTerms: parseSensitiveTerms(settings.nsfw_terms),
    };

    if (settings.prompt_api_enabled && settings.prompt_api_mode === 'openai' && normalizeUrl(settings.prompt_api_url) && cardLibraryEntries.length) {
        try {
            const sceneCastAnalysis = await analyzeSceneCastWithOpenAi(settings, promptContext);
            promptContext.sceneCastAnalysis = sceneCastAnalysis;
            promptContext.sceneInteractionSummary = sceneCastAnalysis.interactionSummary;
            promptContext.selectedCardEntries = selectSceneEntriesFromAnalysis(cardLibraryEntries, sceneCastAnalysis);
        } catch (error) {
            console.warn('Failed to analyze visible scene cast for prompt generation', error);
        }
    }

    return promptContext;
}

function formatDescriptorEntries(entries) {
    return entries
        .map(entry => {
            const aliases = Array.isArray(entry.aliases) && entry.aliases.length
                ? ` (aliases: ${entry.aliases.join(', ')})`
                : '';
            return `- ${entry.name}${aliases}: ${entry.descriptor}`;
        })
        .join('\n');
}

function buildOpenAiPromptMessages(promptContext) {
    const { settings, latestMessageText, sanitizedSourceText, sourceMessage, cardContext, selectedCardEntries, sceneCastAnalysis, sceneInteractionSummary, personaContext, personaDescriptor, sensitiveTerms } = promptContext;
    const systemRules = [
        getEffectivePromptAssistantSystemPrompt(settings),
        'Use the provided stable descriptor library as the authoritative identity anchor for recurring characters and the user persona.',
        'Follow this workflow strictly: first read the whole visible scene, then determine who is actually present, then preserve the visible interaction, then use descriptor anchors only for those present characters.',
        'Do not force descriptor-library characters that are only mentioned, remembered, or off-screen.',
        'Do not omit stable appearance traits from the descriptor library when they are relevant to the selected scene.',
        'Preserve scene intent, composition, pose, camera angle, lighting, emotional tone, outfit state, and world details.',
    ];

    if (settings.nsfw_guard_enabled && sensitiveTerms.length) {
        systemRules.push(`Avoid using these sensitive terms verbatim when possible: ${sensitiveTerms.join(', ')}`);
    }

    if (settings.nsfw_guard_enabled && String(settings.nsfw_rewrite_hint || '').trim()) {
        systemRules.push(`Additional rewrite guidance: ${String(settings.nsfw_rewrite_hint).trim()}`);
    }

    const sections = [
        `Current assistant speaker: ${sourceMessage?.name || ''}`,
        `Selected AI message:\n${latestMessageText}`,
    ];

    if (settings.nsfw_guard_enabled && sanitizedSourceText && sanitizedSourceText !== latestMessageText) {
        sections.push(`Safety-normalized visual reference (prioritize this when raw wording is too explicit):\n${sanitizedSourceText}`);
    }

    if (cardContext) {
        sections.push(`Current card: ${cardContext.label} (${cardContext.type})`);
    }

    if (sceneCastAnalysis) {
        sections.push(`Present descriptor-library characters in the current visible scene: ${sceneCastAnalysis.presentCharacters.length ? sceneCastAnalysis.presentCharacters.join(', ') : 'none'}`);
        sections.push(`Mentioned but absent descriptor-library characters: ${sceneCastAnalysis.mentionedButAbsent.length ? sceneCastAnalysis.mentionedButAbsent.join(', ') : 'none'}`);
    } else {
        sections.push('Present descriptor-library characters in the current visible scene: unknown');
    }

    if (sceneInteractionSummary) {
        sections.push(`Visible interaction summary:\n${sceneInteractionSummary}`);
    }

    if (selectedCardEntries.length) {
        sections.push(`Stable descriptors for present characters only:\n${formatDescriptorEntries(selectedCardEntries)}`);
    }

    if (personaDescriptor) {
        sections.push(`Stable user persona descriptor:\n- ${personaContext?.label || 'User'}: ${personaDescriptor}`);
    }

    const anchorSegments = buildPromptAnchorSegments(promptContext);
    if (anchorSegments.length) {
        sections.push(`These anchor traits must remain visible in the final prompt:\n${anchorSegments.join('\n')}`);
    }

    return [
        {
            role: 'system',
            content: systemRules.join('\n'),
        },
        {
            role: 'user',
            content: sections.join('\n\n'),
        },
    ];
}

async function requestPromptApiChatCompletion(settings, messages, { temperature = 0.4 } = {}) {
    const model = String(settings.prompt_api_model || '').trim();

    if (!model) {
        throw new Error('提示词模型不能为空。');
    }

    if (shouldUseSillyTavernPromptProxy(settings)) {
        return await requestPromptApiChatCompletionViaSillyTavern(settings, messages, { temperature });
    }

    return await fetchJsonOrText(getPromptApiChatCompletionsUrl(settings), {
        method: 'POST',
        headers: getPromptApiHeaders(settings),
        body: JSON.stringify({
            model,
            messages,
            temperature,
            stream: false,
        }),
    });
}

async function buildPrompt(sourceMessage) {
    const settings = ensureSettings();
    const latestMessageText = getPlainMessageText(sourceMessage);

    if (!latestMessageText) {
        throw new Error('清理后的 AI 消息正文为空。');
    }

    setBusyPhase('prompt', '正在通读这一层正文，确认当前画面中谁在场、谁离场，以及人物之间的互动。', '场景判定');
    const promptContext = await buildPromptGenerationContext(sourceMessage, latestMessageText);

    if (!settings.prompt_api_enabled || !normalizeUrl(settings.prompt_api_url)) {
        return mergePromptWithAnchors(buildFallbackPromptFromContext(promptContext), promptContext);
    }

    let prompt = '';

    try {
        setBusyPhase('prompt', '正在结合在场人物、互动关系和角色词库生成画面提示词。', '生成提示词');
        prompt = settings.prompt_api_mode === 'openai'
            ? await buildPromptWithOpenAiCompatibleApiEnhanced(settings, promptContext)
            : await buildPromptWithCustomApiEnhanced(settings, promptContext);
    } catch (error) {
        if (settings.nsfw_guard_enabled && isPromptSafetyBlockError(error)) {
            setBusyPhase('prompt', '提示词接口拦截了原文，正在切换到安全改写回退方案。', '安全回退');
            return mergePromptWithAnchors(buildFallbackPromptFromContext(promptContext), promptContext);
        }

        throw error;
    }

    return mergePromptWithAnchors(prompt, promptContext);
}

async function buildPromptWithOpenAiCompatibleApiEnhanced(settings, promptContext) {
    const result = await requestPromptApiChatCompletion(settings, buildOpenAiPromptMessages(promptContext), {
        temperature: 0.65,
    });
    const prompt = getPromptFromPayload(result);

    if (!prompt) {
        throw new Error('提示词接口没有返回可用的提示词。');
    }

    return prompt;
}

async function buildPromptWithCustomApiEnhanced(settings, promptContext) {
    const { latestMessageText, sanitizedSourceText, sourceMessage, cardContext, cardLibraryEntries, selectedCardEntries, sceneCastAnalysis, sceneInteractionSummary, personaContext, personaDescriptor, sensitiveTerms } = promptContext;
    const result = await fetchJsonOrText(normalizeUrl(settings.prompt_api_url), {
        method: 'POST',
        headers: getPromptApiHeaders(settings),
        body: JSON.stringify({
            message: latestMessageText,
            raw_message: String(sourceMessage.mes || latestMessageText || ''),
            safe_message: sanitizedSourceText,
            prompt_system_instruction: getEffectivePromptAssistantSystemPrompt(settings),
            character_name: sourceMessage.name || '',
            message_id: Array.isArray(getContext().chat) ? getContext().chat.indexOf(sourceMessage) : -1,
            card_context: cardContext
                ? {
                    key: cardContext.key,
                    label: cardContext.label,
                    type: cardContext.type,
                    source_text: cardContext.sourceText,
                }
                : null,
            character_selection_rules: {
                workflow: [
                    'Read the entire visible scene, not just keywords.',
                    'Determine who is physically present in the scene right now.',
                    'Separate present characters from mentioned-but-absent characters.',
                    'Summarize the visible interaction between present characters.',
                    'Only then decide whether to inject character descriptors.',
                ],
                max_descriptor_anchors: MAX_PROMPT_CHARACTER_ANCHORS,
            },
            scene_cast_analysis: sceneCastAnalysis,
            visible_interaction_summary: sceneInteractionSummary,
            all_character_descriptors: cardLibraryEntries,
            character_anchor_descriptors: selectedCardEntries,
            persona_descriptor: personaDescriptor
                ? {
                    key: personaContext?.key || '',
                    label: personaContext?.label || '',
                    descriptor: personaDescriptor,
                }
                : null,
            safe_rewrite: {
                enabled: !!settings.nsfw_guard_enabled,
                sensitive_terms: sensitiveTerms,
                rewrite_hint: String(settings.nsfw_rewrite_hint || '').trim(),
            },
        }),
    });
    const prompt = getPromptFromPayload(result);

    if (!prompt) {
        throw new Error('提示词接口没有返回可用的提示词。');
    }

    return prompt;
}

async function requestImage(prompt) {
    const settings = ensureSettings();
    const generationsUrl = buildOpenAiCompatibleEndpointUrl(settings.image_api_url, '/images/generations');

    if (!generationsUrl) {
        throw new Error('生图接口地址不能为空。');
    }

    const headers = {
        'Content-Type': 'application/json',
    };

    if (settings.image_api_key.trim()) {
        headers.Authorization = `Bearer ${settings.image_api_key.trim()}`;
    }

    const payload = {
        model: settings.image_model.trim() || defaultSettings.image_model,
        prompt,
        n: 1,
        response_format: 'b64_json',
    };

    const result = await fetchJsonOrText(generationsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    const base64Data = result?.data?.[0]?.b64_json;

    if (!base64Data) {
        throw new Error('生图接口没有返回可用的图片数据。');
    }

    return base64Data;
}

function buildImageRetryPrompt(prompt, settings = ensureSettings()) {
    let safePrompt = sanitizeSourceForPromptApi(prompt, settings);
    safePrompt = sanitizeGeneratedPrompt(safePrompt, settings);

    if (!safePrompt) {
        return '';
    }

    if (!/tasteful|non-explicit|implied intimacy|cinematic/i.test(safePrompt)) {
        safePrompt = normalizeWhitespace(`${safePrompt}, tasteful, non-explicit, implied intimacy, cinematic lighting, emotional tension`);
    }

    return safePrompt;
}

async function requestImageWithSafetyRetry(prompt) {
    const settings = ensureSettings();

    try {
        return {
            base64Data: await requestImage(prompt),
            promptUsed: prompt,
            safetyRetried: false,
        };
    } catch (error) {
        if (!settings.nsfw_guard_enabled || !isLikelyImageSafetyHeuristic(error, prompt, settings)) {
            throw error;
        }

        const safePrompt = buildImageRetryPrompt(prompt, settings);
        if (!safePrompt) {
            throw new Error('生图接口判定当前提示词过于敏感。请先手动弱化露骨词，再重试。');
        }

        setBusyPhase('image', '生图接口疑似拦截了敏感词，正在切换为安全改写后的提示词重试。', '安全重试');

        try {
            return {
                base64Data: await requestImage(safePrompt),
                promptUsed: safePrompt,
                safetyRetried: true,
            };
        } catch (retryError) {
            if (isLikelyImageSafetyHeuristic(retryError, safePrompt, settings)) {
                throw new Error('生图接口判定当前提示词仍然过于敏感。请先手动删减露骨词，再重试。');
            }

            throw retryError;
        }
    }
}

function buildImageSwipeList(message, imagePath) {
    const swipes = Array.isArray(message?.extra?.image_swipes)
        ? [...message.extra.image_swipes]
        : [];

    if (typeof message?.extra?.image === 'string' && message.extra.image.trim() && !swipes.includes(message.extra.image)) {
        swipes.push(message.extra.image);
    }

    if (!swipes.includes(imagePath)) {
        swipes.push(imagePath);
    }

    return swipes;
}

function syncMessageExtraToCurrentSwipe(messageOrId, { persist = false } = {}) {
    const message = typeof messageOrId === 'object' && messageOrId
        ? messageOrId
        : getMessageById(messageOrId);

    if (!message) {
        return false;
    }

    const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : null;
    if (swipeId === null) {
        return false;
    }

    message.swipe_info = Array.isArray(message.swipe_info) ? message.swipe_info : [];
    const currentSwipeInfo = message.swipe_info[swipeId] && typeof message.swipe_info[swipeId] === 'object'
        ? message.swipe_info[swipeId]
        : {};

    const nextExtra = cloneForStorage(message.extra || {});
    const currentExtraSerialized = JSON.stringify(currentSwipeInfo.extra || null);
    const nextExtraSerialized = JSON.stringify(nextExtra || null);

    if (currentExtraSerialized === nextExtraSerialized) {
        return false;
    }

    message.swipe_info[swipeId] = {
        ...currentSwipeInfo,
        extra: nextExtra,
    };

    if (persist) {
        scheduleCurrentChatSave();
    }

    return true;
}

async function attachImageToMessage(messageId, prompt, base64Data, sourceMessage) {
    const context = getContext();
    const speakerName = sourceMessage?.name || context.name2 || 'Image';
    const fileStem = speakerName || 'Image';
    const imagePath = await saveBase64AsFile(base64Data, fileStem, `${fileStem}_${Date.now()}`, 'png');
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const message = chat[messageId] || sourceMessage;
    const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
    const inlineAnchor = getInlineButtonAnchor(messageElement, messageId, message);
    message.extra = message.extra || {};
    message.extra.image = imagePath;
    message.extra.title = prompt;
    message.extra.inline_image = false;
    message.extra.image_swipes = buildImageSwipeList(message, imagePath);
    message.extra.chatgpt2api_image_meta = {
        ...message.extra.chatgpt2api_image_meta,
        prompt,
        inline_anchor_index: inlineAnchor?.index ?? message.extra?.chatgpt2api_image_meta?.inline_anchor_index ?? null,
        updatedAt: Date.now(),
    };
    syncMessageExtraToCurrentSwipe(message);

    updateMessageBlock(messageId, message, { rerenderMessage: true });
    scheduleMessageMediaRefresh(messageId, { retryBrokenImage: true });
    await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, messageId, 'extension');
    await context.saveChat();
    scheduleMessageMediaRefresh(messageId, { retryBrokenImage: true });

    return { imagePath, messageId };
}

function getPanel() {
    return $(`#${PANEL_ID}`);
}

function isPanelVisible() {
    return getPanel().hasClass(PANEL_VISIBLE_CLASS);
}

function getControlPanel() {
    return $(`#${CONTROL_PANEL_ID}`);
}

function getControlFab() {
    return $(`#${CONTROL_FAB_ID}`);
}

function attachSettingsContentToControlPanel() {
    const settingsContent = $('#st_chatgpt2api_image_settings_content');
    const settingsSlot = $('#st_chatgpt2api_image_control_panel_settings_slot');

    if (!settingsContent.length || !settingsSlot.length) {
        return;
    }

    if (settingsContent.parent()[0] !== settingsSlot[0]) {
        settingsContent.detach().removeClass('displayNone').appendTo(settingsSlot);
    }
}

function getPanelPromptValue() {
    return String($('#st_chatgpt2api_image_panel_prompt').val() || '').trim();
}

function setPanelPromptValue(value) {
    $('#st_chatgpt2api_image_panel_prompt').val(String(value || ''));
}

function bindControlFabDrag() {
    const fab = getControlFab();
    if (!fab.length) {
        return;
    }

    const dragNamespace = '.stChatgpt2apiImageFabDrag';
    const ignoreSelector = 'button, input, textarea, select, a';
    const supportsPointerEvents = typeof window.PointerEvent === 'function';
    let dragState = null;

    const getClientPoint = (event) => {
        const originalEvent = event?.originalEvent || event;

        if (originalEvent?.touches?.length) {
            return {
                clientX: originalEvent.touches[0].clientX,
                clientY: originalEvent.touches[0].clientY,
            };
        }

        if (originalEvent?.changedTouches?.length) {
            return {
                clientX: originalEvent.changedTouches[0].clientX,
                clientY: originalEvent.changedTouches[0].clientY,
            };
        }

        return {
            clientX: Number(originalEvent?.clientX || 0),
            clientY: Number(originalEvent?.clientY || 0),
        };
    };

    const unbindDragEvents = () => {
        $(document).off(`pointermove${dragNamespace}`);
        $(document).off(`pointerup${dragNamespace}`);
        $(document).off(`pointercancel${dragNamespace}`);
        $(document).off(`mousemove${dragNamespace}`);
        $(document).off(`mouseup${dragNamespace}`);
        $(document).off(`touchmove${dragNamespace}`);
        $(document).off(`touchend${dragNamespace}`);
        $(document).off(`touchcancel${dragNamespace}`);
    };

    const stopDrag = () => {
        if (dragState?.moved) {
            fab.data('dragMovedAt', Date.now());
        }

        if (dragState?.pointerId != null && fab[0]?.releasePointerCapture) {
            try {
                fab[0].releasePointerCapture(dragState.pointerId);
            } catch {
                // Ignore pointer-capture release errors from browsers that already released it.
            }
        }

        dragState = null;
        fab.removeClass('is-dragging');
        unbindDragEvents();
    };

    const startDrag = (event) => {
        if ($(event.target).closest(ignoreSelector).length) {
            return false;
        }

        const originalEvent = event?.originalEvent || event;
        if ((originalEvent?.pointerType === 'mouse' || event.type === 'mousedown') && originalEvent.button !== 0) {
            return false;
        }

        const { clientX, clientY } = getClientPoint(event);
        const rect = fab[0].getBoundingClientRect();
        dragState = {
            startX: clientX,
            startY: clientY,
            left: rect.left,
            top: rect.top,
            moved: false,
            pointerId: originalEvent?.pointerId ?? null,
        };

        fab.css({
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            right: 'auto',
            bottom: 'auto',
        });

        event.preventDefault();
        return true;
    };

    const handleDragMove = (event) => {
        if (!dragState) {
            return;
        }

        const { clientX, clientY } = getClientPoint(event);
        event.preventDefault();

        const deltaX = clientX - dragState.startX;
        const deltaY = clientY - dragState.startY;

        if (!dragState.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
            dragState.moved = true;
            fab.addClass('is-dragging');
        }

        const nextLeft = dragState.left + deltaX;
        const nextTop = dragState.top + deltaY;
        const maxLeft = Math.max(0, window.innerWidth - fab.outerWidth());
        const maxTop = Math.max(0, window.innerHeight - fab.outerHeight());

        fab.css({
            left: `${Math.min(Math.max(0, nextLeft), maxLeft)}px`,
            top: `${Math.min(Math.max(0, nextTop), maxTop)}px`,
        });
    };

    unbindDragEvents();
    fab.off(`pointerdown${dragNamespace}`);
    fab.off(`mousedown${dragNamespace}`);
    fab.off(`touchstart${dragNamespace}`);

    if (supportsPointerEvents) {
        fab.on(`pointerdown${dragNamespace}`, function (event) {
            if (!startDrag(event)) {
                return;
            }

            if (dragState?.pointerId != null && fab[0]?.setPointerCapture) {
                try {
                    fab[0].setPointerCapture(dragState.pointerId);
                } catch {
                    // Ignore browsers that reject capture for this interaction.
                }
            }

            $(document).on(`pointermove${dragNamespace}`, handleDragMove);
            $(document).on(`pointerup${dragNamespace}`, stopDrag);
            $(document).on(`pointercancel${dragNamespace}`, stopDrag);
        });
        return;
    }

    fab.on(`mousedown${dragNamespace} touchstart${dragNamespace}`, function (event) {
        if (!startDrag(event)) {
            return;
        }

        if (event.type === 'touchstart') {
            $(document).on(`touchmove${dragNamespace}`, handleDragMove);
            $(document).on(`touchend${dragNamespace}`, stopDrag);
            $(document).on(`touchcancel${dragNamespace}`, stopDrag);
            return;
        }

        $(document).on(`mousemove${dragNamespace}`, handleDragMove);
        $(document).on(`mouseup${dragNamespace}`, stopDrag);
    });
}

function setPanelPreview(imagePath = '', prompt = '') {
    const image = $('#st_chatgpt2api_image_panel_preview');
    const emptyState = $('#st_chatgpt2api_image_panel_preview_empty');

    if (!image.length) {
        return;
    }

    if (imagePath) {
        image.attr('src', imagePath).attr('title', prompt || '').removeClass('displayNone');
        emptyState.addClass('displayNone');
        return;
    }

    image.attr('src', '').attr('title', '').addClass('displayNone');
    emptyState.removeClass('displayNone');
}

function applyInlineButtonEnabledState(enabled = isInlineImageButtonEnabled()) {
    if (!enabled) {
        runtimeState.selectedMessageId = null;
        closeFloatingPanel();
        setStatus('消息内生图按钮已关闭。你仍然可以从悬浮控制台重新开启。', 'info');
    } else {
        setStatus('消息内生图按钮已开启。选中一条消息后即可开始。', 'success');
    }

    scheduleSyncAllMessageActionButtons();
}

function restoreMessageTextVisibility(messageId) {
    const normalizedId = normalizeMessageId(messageId);
    if (normalizedId === null) {
        return;
    }

    const messageElement = $(`#chat .mes[mesid="${normalizedId}"]`);
    if (!messageElement.length) {
        return;
    }

    messageElement.find('.mes_text').removeClass('displayNone');
}

function updatePanelMaximizeIcon() {
    const icon = $('#st_chatgpt2api_image_panel_maximize .floating_panel_maximize');
    if (!icon.length) {
        return;
    }

    const isMaximized = getPanel().hasClass(PANEL_MAXIMIZED_CLASS);
    icon.toggleClass('fa-window-maximize', !isMaximized);
    icon.toggleClass('fa-window-restore', isMaximized);
}

function updateControlPanelMaximizeIcon() {
    const icon = $('#st_chatgpt2api_image_control_panel_maximize .floating_panel_maximize');
    if (!icon.length) {
        return;
    }

    const isMaximized = getControlPanel().hasClass(PANEL_MAXIMIZED_CLASS);
    icon.toggleClass('fa-window-maximize', !isMaximized);
    icon.toggleClass('fa-window-restore', isMaximized);
}

function updateInteractiveState() {
    const busyMeta = getBusyPhaseMeta(isGenerating ? runtimeState.busyPhase : 'idle');

    $(MESSAGE_BUTTON_SELECTOR)
        .toggleClass('is-busy', isGenerating)
        .attr('aria-disabled', String(isGenerating));

    $('.st-chatgpt2api-image-panel-action')
        .toggleClass('disabled', isGenerating)
        .toggleClass('is-busy', isGenerating)
        .attr('aria-disabled', String(isGenerating));

    getPanel()
        .toggleClass('is-busy', isGenerating)
        .attr('data-busy-state', isGenerating ? runtimeState.busyPhase : 'idle');

    $('#st_chatgpt2api_image_panel_busy_chip').toggleClass('is-active', isGenerating);
    $('#st_chatgpt2api_image_panel_busy_label').text(busyMeta.label);
    $('#st_chatgpt2api_image_panel_preview_loading_label').text(busyMeta.label);
    $('#st_chatgpt2api_image_panel_preview_loading_hint').text(busyMeta.hint);
    $('#st_chatgpt2api_image_panel_preview_loading').toggleClass('displayNone', !isGenerating);
    $('.st-chatgpt2api-image-preview-shell').toggleClass('is-loading', isGenerating);

    $(MESSAGE_BUTTON_SELECTOR).removeClass('is-active');
    $(MESSAGE_BUTTON_SELECTOR).removeClass('is-loading-target');
    $(MESSAGE_BUTTON_SELECTOR).find('.st-chatgpt2api-image-inline-button-label').text('生图');

    if (Number.isInteger(runtimeState.selectedMessageId)) {
        const selectedButton = $(`${MESSAGE_BUTTON_SELECTOR}[data-st-message-id="${runtimeState.selectedMessageId}"]`);
        selectedButton.addClass('is-active');

        if (isGenerating) {
            selectedButton
                .addClass('is-loading-target')
                .find('.st-chatgpt2api-image-inline-button-label')
                .text(busyMeta.label);
        }
    }
}

function updatePanelSelection(resetPrompt = false) {
    const selectedMessage = getMessageById(runtimeState.selectedMessageId);

    if (!selectedMessage) {
        runtimeState.selectedMessageId = null;
        $('#st_chatgpt2api_image_panel_source_label').text('选择一条 AI 回复开始。');
        $('#st_chatgpt2api_image_panel_source_meta').text('');
        $('#st_chatgpt2api_image_panel_source_text').text('点击任意一条助手消息里的生图按钮，就会把正文带到这里。');
        if (resetPrompt) {
            setPanelPromptValue('');
        }
        setPanelPreview();
        updateInteractiveState();
        return;
    }

    const cleanText = getPlainMessageText(selectedMessage);
    const messageLabel = (selectedMessage.name || '助手') + ' · 第 ' + (runtimeState.selectedMessageId + 1) + ' 层';
    const existingPrompt = String(selectedMessage?.extra?.chatgpt2api_image_meta?.prompt || selectedMessage?.extra?.title || '').trim();
    const existingImage = String(selectedMessage?.extra?.image || '').trim();

    $('#st_chatgpt2api_image_panel_source_label').text(messageLabel);
    $('#st_chatgpt2api_image_panel_source_meta').text('楼层 ' + (runtimeState.selectedMessageId + 1));
    $('#st_chatgpt2api_image_panel_source_text').text(cleanText);

    if (resetPrompt || !getPanelPromptValue()) {
        setPanelPromptValue(existingPrompt || cleanText);
    }

    setPanelPreview(existingImage, existingPrompt || selectedMessage?.extra?.title || '');
    updateInteractiveState();
}

function openFloatingPanel() {
    const panel = getPanel();
    if (!panel.length) {
        return;
    }

    panel.addClass(PANEL_VISIBLE_CLASS);
    updatePanelMaximizeIcon();
}

function closeFloatingPanel() {
    const panel = getPanel();
    if (!panel.length) {
        return;
    }

    if (panel.hasClass(PANEL_MAXIMIZED_CLASS)) {
        toggleFloatingPanelMaximize();
    }

    panel.removeClass(PANEL_VISIBLE_CLASS);
}

function toggleFloatingPanelMaximize() {
    const panel = getPanel();
    if (!panel.length) {
        return;
    }

    if (panel.hasClass(PANEL_MAXIMIZED_CLASS)) {
        const restoreStyle = String(panel.data('restoreStyle') || '');
        panel.removeClass(PANEL_MAXIMIZED_CLASS);
        panel[0].style.cssText = restoreStyle;
    } else {
        panel.data('restoreStyle', panel[0].style.cssText || '');
        panel.addClass(PANEL_MAXIMIZED_CLASS);
    }

    panel.addClass(PANEL_VISIBLE_CLASS);
    updatePanelMaximizeIcon();
}

function openControlPanel() {
    const panel = getControlPanel();
    if (!panel.length) {
        return;
    }

    attachSettingsContentToControlPanel();
    refreshDescriptorLibraryUi();
    getControlFab().addClass('displayNone');
    panel.addClass(PANEL_VISIBLE_CLASS);
    updateControlPanelMaximizeIcon();
}

function closeControlPanel() {
    const panel = getControlPanel();
    if (!panel.length) {
        return;
    }

    if (panel.hasClass(PANEL_MAXIMIZED_CLASS)) {
        toggleControlPanelMaximize();
    }

    panel.removeClass(PANEL_VISIBLE_CLASS);
    getControlFab().removeClass('displayNone');
}

function toggleControlPanelMaximize() {
    const panel = getControlPanel();
    if (!panel.length) {
        return;
    }

    if (panel.hasClass(PANEL_MAXIMIZED_CLASS)) {
        const restoreStyle = String(panel.data('restoreStyle') || '');
        panel.removeClass(PANEL_MAXIMIZED_CLASS);
        panel[0].style.cssText = restoreStyle;
    } else {
        panel.data('restoreStyle', panel[0].style.cssText || '');
        panel.addClass(PANEL_MAXIMIZED_CLASS);
    }

    panel.addClass(PANEL_VISIBLE_CLASS);
    updateControlPanelMaximizeIcon();
}

async function addControlPanel() {
    if (getControlPanel().length) {
        attachSettingsContentToControlPanel();
        bindControlFabDrag();
        return;
    }

    const controlPanelHtml = await renderExtensionTemplateAsync(EXTENSION_NAME, 'control-panel');
    const mountPoint = $('#movingDivs').length ? $('#movingDivs') : $('body');

    mountPoint.append(controlPanelHtml);
    const panel = getControlPanel();

    loadMovingUIState();
    attachSettingsContentToControlPanel();

    $('#st_chatgpt2api_image_control_panel_close').on('click', closeControlPanel);
    $('#st_chatgpt2api_image_control_panel_maximize').on('click', toggleControlPanelMaximize);
    $('#st_chatgpt2api_image_panel_open_control').on('click', openControlPanel);
    $('#st_chatgpt2api_image_open_control_panel').on('click', openControlPanel);
    getControlFab().on('click', function (event) {
        const lastDraggedAt = Number(getControlFab().data('dragMovedAt') || 0);
        if (Date.now() - lastDraggedAt < 250) {
            event.preventDefault();
            return;
        }

        openControlPanel();
    });
    bindControlFabDrag();

    updateControlPanelMaximizeIcon();
}

async function addFloatingPanel() {
    if (getPanel().length) {
        return;
    }

    const panelHtml = await renderExtensionTemplateAsync(EXTENSION_NAME, 'panel');
    const mountPoint = $('#movingDivs').length ? $('#movingDivs') : $('body');

    mountPoint.append(panelHtml);
    const panel = getPanel();

    loadMovingUIState();

    $('#st_chatgpt2api_image_panel_close').on('click', closeFloatingPanel);
    $('#st_chatgpt2api_image_panel_maximize').on('click', toggleFloatingPanelMaximize);
    $('#st_chatgpt2api_image_panel_open_control').on('click', openControlPanel);
    $('#st_chatgpt2api_image_panel_generate_prompt').on('click', onGeneratePromptClick);
    $('#st_chatgpt2api_image_panel_generate_image').on('click', onGenerateImageClick);
    $('#st_chatgpt2api_image_panel_generate_all').on('click', onGenerateAllClick);

    updatePanelSelection(true);
    setStatus('选中一条消息后即可开始。');
}

function selectMessage(messageId, { openPanel = true } = {}) {
    const normalizedId = normalizeMessageId(messageId);
    const message = getMessageById(normalizedId);

    if (!message) {
        toastr.error('没有找到可用于生图的助手消息。', TOAST_TITLE);
        return null;
    }

    const shouldResetPrompt = runtimeState.selectedMessageId !== normalizedId;
    runtimeState.selectedMessageId = normalizedId;
    updatePanelSelection(shouldResetPrompt);

    if (openPanel) {
        openFloatingPanel();
    }

    setStatus('当前楼层已就绪，可以直接生成提示词或生图。');
    return { messageId: normalizedId, message };
}

function ensureSelectedMessage() {
    const current = getMessageById(runtimeState.selectedMessageId);
    if (current) {
        return { messageId: runtimeState.selectedMessageId, message: current };
    }

    const latestEntry = getLatestAssistantMessageEntry();
    if (!latestEntry) {
        toastr.error('没有找到可用于生图的助手消息。', TOAST_TITLE);
        return null;
    }

    runtimeState.selectedMessageId = latestEntry.messageId;
    updatePanelSelection(true);
    return latestEntry;
}

async function runWithBusyState(task, startStatus) {
    if (isGenerating) {
        return null;
    }

    isGenerating = true;
    setBusyPhase('preparing', startStatus, '准备中');

    try {
        return await task();
    } catch (error) {
        console.error('ChatGPT2API image generation failed', error);
        const message = error?.message || '未知错误';
        setStatus('生成失败：' + message, 'error');
        toastr.error(message, TOAST_TITLE);
        return null;
    } finally {
        runtimeState.busyPhase = 'idle';
        isGenerating = false;
        updateInteractiveState();
    }
}

async function generatePromptForSelection() {
    const selected = ensureSelectedMessage();
    if (!selected) {
        return null;
    }

    setBusyPhase('prompt', '正在把选中的 AI 回复整理成画面提示词。', '生成提示词');
    const prompt = await buildPrompt(selected.message);
    setPanelPromptValue(prompt);

    if (ensureSettings().debug) {
        const preview = prompt.length > 300 ? (prompt.slice(0, 300) + '...') : prompt;
        toastr.info(preview, '生成的提示词');
    }

    setStatus('提示词已经生成，可以继续微调后再生图。', 'success', '提示词完成');
    return { ...selected, prompt };
}

async function generateImageForSelection(prompt) {
    const selected = ensureSelectedMessage();
    if (!selected) {
        return null;
    }

    const trimmedPrompt = String(prompt || '').trim();
    if (!trimmedPrompt) {
        throw new Error('提示词为空。');
    }

    setBusyPhase('image', '已向 ChatGPT2API 发出生图请求，正在等待图片返回。', '生成图片');
    const imageResult = await requestImageWithSafetyRetry(trimmedPrompt);
    setBusyPhase('attach', '图片已经返回，正在挂回当前这条消息。', '挂回楼层');
    const result = await attachImageToMessage(selected.messageId, imageResult.promptUsed, imageResult.base64Data, selected.message);

    setPanelPreview(result.imagePath, imageResult.promptUsed);
    if (imageResult.safetyRetried) {
        setPanelPromptValue(imageResult.promptUsed);
        setStatus('检测到生图接口疑似拦截了敏感词，已自动改写提示词并成功返回图片。', 'success', '安全重试成功');
        toastr.success('图片已通过安全改写后的提示词成功返回。', TOAST_TITLE);
    } else {
        setStatus('图片已经挂到当前这条 AI 消息里。', 'success', '生成完成');
        toastr.success('图片已经挂回当前消息。', TOAST_TITLE);
    }

    return result;
}

async function onGeneratePromptClick() {
    openFloatingPanel();
    await runWithBusyState(async () => {
        await generatePromptForSelection();
    }, 'Generating prompt from the selected AI message...');
}

async function onGenerateImageClick() {
    openFloatingPanel();
    await runWithBusyState(async () => {
        await generateImageForSelection(getPanelPromptValue());
    }, 'Generating image from the current prompt...');
}

async function onGenerateAllClick() {
    openFloatingPanel();
    await runWithBusyState(async () => {
        const promptResult = await generatePromptForSelection();
        if (!promptResult) {
            return;
        }

        await generateImageForSelection(promptResult.prompt);
    }, 'Generating prompt and image from the selected AI message...');
}

function buildMessageActionButton(messageId) {
    return $(`
        <div class="st-chatgpt2api-image-message-actions">
            <div
                class="st-chatgpt2api-image-inline-button menu_button menu_button_icon"
                data-st-message-id="${messageId}"
                title="为这条消息生成配图"
            >
                <span class="st-chatgpt2api-image-inline-button-icon">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                </span>
                <span>生图</span>
            </div>
        </div>
    `);
}

function getInlinePlacementCandidates(textContainer) {
    return textContainer
        .children()
        .filter((_, element) => {
            const node = $(element);
            if (!node.is('p, blockquote, ul, ol, h1, h2, h3, h4, hr, div.text_segment, div[data-type="assistant_note"]')) {
                return false;
            }

            if (node.is('pre, table')) {
                return false;
            }

            return node.is('hr') || stripHtml(node.text()).length > 0;
        });
}

function getInlineButtonAnchor(messageElement, messageId, message) {
    const textContainer = messageElement.find('.mes_text').first();
    if (!textContainer.length) {
        return null;
    }

    const candidates = getInlinePlacementCandidates(textContainer);

    if (!candidates.length) {
        return null;
    }

    const storedIndex = message?.extra?.chatgpt2api_image_meta?.inline_anchor_index;
    if (Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < candidates.length) {
        return {
            anchor: candidates.eq(storedIndex),
            index: storedIndex,
        };
    }

    if (candidates.length === 1) {
        return {
            anchor: candidates.eq(0),
            index: 0,
        };
    }

    const latestEntry = getLatestAssistantMessageEntry();
    if (!latestEntry || latestEntry.messageId !== messageId) {
        return null;
    }

    const ratios = [0.34, 0.52, 0.68];
    const ratio = ratios[messageId % ratios.length];
    const maxIndex = Math.max(0, candidates.length - 2);
    const targetIndex = Math.max(0, Math.min(maxIndex, Math.round(maxIndex * ratio)));
    return {
        anchor: candidates.eq(targetIndex),
        index: targetIndex,
    };
}

function getExistingInlineSlot(textContainer, messageId) {
    const messageSlots = textContainer.find(`> ${MESSAGE_INLINE_SLOT_SELECTOR}[data-st-message-id="${messageId}"]`);
    if (messageSlots.length > 1) {
        messageSlots.slice(1).remove();
    }

    return messageSlots.first();
}

function clearMessageMediaRefreshTimers(messageId) {
    const normalizedId = normalizeMessageId(messageId);
    if (normalizedId === null) {
        return;
    }

    const timers = runtimeState.mediaRefreshTimers.get(normalizedId);
    if (!Array.isArray(timers)) {
        return;
    }

    for (const timerId of timers) {
        clearTimeout(timerId);
    }

    runtimeState.mediaRefreshTimers.delete(normalizedId);
}

function buildCacheBustedImageSrc(imagePath, cacheToken) {
    const normalizedPath = normalizeUrl(imagePath);
    if (!normalizedPath) {
        return '';
    }

    const separator = normalizedPath.includes('?') ? '&' : '?';
    return `${normalizedPath}${separator}stchatgpt2api=${encodeURIComponent(String(cacheToken))}`;
}

function isBrokenMessageImage(imageElement) {
    if (!imageElement?.length) {
        return true;
    }

    const domImage = imageElement.get(0);
    if (!(domImage instanceof HTMLImageElement)) {
        return false;
    }

    return imageElement.hasClass('error') || (domImage.complete && domImage.naturalWidth === 0);
}

function refreshMessageMediaPresentation(messageId, { retryBrokenImage = false, useCacheBust = false } = {}) {
    const normalizedId = normalizeMessageId(messageId);
    if (normalizedId === null) {
        return false;
    }

    const message = getMessageById(normalizedId);
    if (!message?.extra?.image) {
        return false;
    }

    const messageElement = $(`#chat .mes[mesid="${normalizedId}"]`);
    if (!messageElement.length) {
        return false;
    }

    appendMediaToMessage(message, messageElement, false);

    const imageElement = messageElement.find('.mes_img').first();
    const shouldForceReload = retryBrokenImage && isBrokenMessageImage(imageElement);
    if (imageElement.length && (shouldForceReload || useCacheBust)) {
        const runtimeSrc = buildCacheBustedImageSrc(
            message.extra.image,
            message?.extra?.chatgpt2api_image_meta?.updatedAt || Date.now(),
        );

        if (runtimeSrc) {
            imageElement.removeClass('error');
            imageElement.removeAttr('alt');
            imageElement.attr('src', runtimeSrc);
        }
    }

    restoreMessageTextVisibility(normalizedId);
    applyInlineMediaPlacement(normalizedId);
    return true;
}

function scheduleMessageMediaRefresh(messageId, { retryBrokenImage = false } = {}) {
    const normalizedId = normalizeMessageId(messageId);
    if (normalizedId === null) {
        return;
    }

    clearMessageMediaRefreshTimers(normalizedId);

    const message = getMessageById(normalizedId);
    if (!message?.extra?.image) {
        return;
    }

    const timers = MEDIA_REFRESH_RETRY_DELAYS.map((delay, index) => window.setTimeout(() => {
        refreshMessageMediaPresentation(normalizedId, {
            retryBrokenImage,
            useCacheBust: retryBrokenImage && index > 0,
        });

        if (index === MEDIA_REFRESH_RETRY_DELAYS.length - 1) {
            clearMessageMediaRefreshTimers(normalizedId);
        }
    }, delay));

    runtimeState.mediaRefreshTimers.set(normalizedId, timers);
}

function ensureInlineSlot(textContainer, messageId, inlineAnchor) {
    if (!textContainer.length || !inlineAnchor?.anchor?.length) {
        return $();
    }

    let inlineSlot = getExistingInlineSlot(textContainer, messageId);

    if (!inlineSlot.length) {
        inlineSlot = $(`
            <div class="st-chatgpt2api-image-inline-slot" data-st-message-id="${messageId}">
                <div class="st-chatgpt2api-image-inline-slot-actions"></div>
                <div class="st-chatgpt2api-image-inline-slot-media"></div>
            </div>
        `);
    } else {
        inlineSlot.attr('data-st-message-id', String(messageId));
    }

    if (!inlineSlot.find(MESSAGE_INLINE_SLOT_ACTIONS_SELECTOR).length) {
        inlineSlot.prepend('<div class="st-chatgpt2api-image-inline-slot-actions"></div>');
    }

    if (!inlineSlot.find(MESSAGE_INLINE_SLOT_MEDIA_SELECTOR).length) {
        inlineSlot.append('<div class="st-chatgpt2api-image-inline-slot-media"></div>');
    }

    inlineAnchor.anchor.after(inlineSlot);
    return inlineSlot;
}

function applyInlineMediaPlacement(messageId) {
    const normalizedId = normalizeMessageId(messageId);
    if (normalizedId === null) {
        return;
    }

    const messageElement = $(`#chat .mes[mesid="${normalizedId}"]`);
    if (!messageElement.length) {
        return;
    }

    const imageContainers = messageElement.find('.mes_img_container');
    const textContainer = messageElement.find('.mes_text').first();
    if (!imageContainers.length || !textContainer.length) {
        return;
    }

    const imageContainer = imageContainers.last();
    imageContainers.not(imageContainer).remove();

    const inlineSlot = getExistingInlineSlot(textContainer, normalizedId);
    const inlineMediaSlot = inlineSlot.find(MESSAGE_INLINE_SLOT_MEDIA_SELECTOR).first();
    if (inlineMediaSlot.length) {
        inlineMediaSlot.append(imageContainer);
        imageContainer.addClass('st-chatgpt2api-image-inline-media');
        return;
    }

    const inlineAction = textContainer.find(`${MESSAGE_ACTION_SELECTOR}.is-inline`).first();

    if (inlineAction.length) {
        inlineAction.after(imageContainer);
        imageContainer.addClass('st-chatgpt2api-image-inline-media');
        return;
    }

    textContainer.after(imageContainer);
    imageContainer.removeClass('st-chatgpt2api-image-inline-media');
}

function syncMessageActionButton(messageId) {
    const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement.length) {
        return;
    }

    messageElement.find(MESSAGE_ACTION_SELECTOR).remove();

    const message = getMessageById(messageId);
    if (!message) {
        return;
    }

    const anchor = messageElement.find('.mes_text').first();
    if (!anchor.length) {
        return;
    }

    const inlineAnchor = getInlineButtonAnchor(messageElement, messageId, message);
    const hasInlineImage = messageElement.find('.mes_img_container').length > 0;

    if (!isInlineImageButtonEnabled()) {
        if (message?.extra?.chatgpt2api_image_meta || hasInlineImage) {
            const inlineSlot = inlineAnchor?.anchor?.length
                ? ensureInlineSlot(anchor, messageId, inlineAnchor)
                : getExistingInlineSlot(anchor, messageId);

            if (inlineSlot.length) {
                restoreMessageTextVisibility(messageId);
                applyInlineMediaPlacement(messageId);
            }
        }

        return;
    }

    const actionButton = buildMessageActionButton(messageId);
    const actionTrigger = actionButton.find(MESSAGE_BUTTON_SELECTOR);
    actionTrigger
        .attr('title', '为这条消息生成配图')
        .empty()
        .append(`
            <span class="st-chatgpt2api-image-inline-button-icon">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
            </span>
            <span class="st-chatgpt2api-image-inline-button-label">生图</span>
        `);

    if (inlineAnchor?.anchor?.length) {
        const inlineSlot = ensureInlineSlot(anchor, messageId, inlineAnchor);
        actionButton.addClass('is-inline');
        inlineSlot.find(MESSAGE_INLINE_SLOT_ACTIONS_SELECTOR).first().append(actionButton);
    } else {
        anchor.find(`> ${MESSAGE_INLINE_SLOT_SELECTOR}[data-st-message-id="${messageId}"]`).remove();
        anchor.after(actionButton);
    }

    const hasInlineSlot = anchor.find(`> ${MESSAGE_INLINE_SLOT_SELECTOR}[data-st-message-id="${messageId}"]`).length > 0;
    if (message?.extra?.chatgpt2api_image_meta || hasInlineImage || hasInlineSlot) {
        restoreMessageTextVisibility(messageId);
        applyInlineMediaPlacement(messageId);
    }
}

function syncAllMessageActionButtons() {
    $('#chat .mes').each((_, element) => {
        const messageId = normalizeMessageId($(element).attr('mesid'));
        if (messageId === null) {
            return;
        }

        syncMessageActionButton(messageId);
    });

    updateInteractiveState();

    if (runtimeState.selectedMessageId !== null) {
        updatePanelSelection(false);
    }
}

function scheduleSyncAllMessageActionButtons() {
    if (runtimeState.syncTimer) {
        clearTimeout(runtimeState.syncTimer);
    }

    runtimeState.syncTimer = window.setTimeout(() => {
        runtimeState.syncTimer = null;
        syncAllMessageActionButtons();
    }, 0);
}

async function onInlineImageSwiped({ message, element, direction }) {
    if (!message?.extra?.chatgpt2api_image_meta) {
        return;
    }

    const swipes = message?.extra?.image_swipes;

    if (!Array.isArray(swipes) || swipes.length < 2) {
        return;
    }

    const currentIndex = swipes.indexOf(message.extra.image);

    if (currentIndex === -1) {
        return;
    }

    const nextIndex = direction === 'left'
        ? (currentIndex === 0 ? swipes.length - 1 : currentIndex - 1)
        : (currentIndex === swipes.length - 1 ? 0 : currentIndex + 1);

    const normalizedMessageId = normalizeMessageId($(element).attr('mesid'));
    message.extra.image = swipes[nextIndex];
    syncMessageExtraToCurrentSwipe(message);
    appendMediaToMessage(message, element, false);
    restoreMessageTextVisibility(normalizedMessageId);
    applyInlineMediaPlacement(normalizedMessageId);
    scheduleMessageMediaRefresh(normalizedMessageId, { retryBrokenImage: true });

    if (runtimeState.selectedMessageId !== null && getMessageById(runtimeState.selectedMessageId) === message) {
        setPanelPreview(message.extra.image, message.extra.title || '');
    }

    await getContext().saveChat();
}

function observeChatMutations() {
    if (runtimeState.chatObserver) {
        return;
    }

    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        window.setTimeout(observeChatMutations, 500);
        return;
    }

    runtimeState.chatObserver = new MutationObserver(() => {
        scheduleSyncAllMessageActionButtons();
    });

    runtimeState.chatObserver.observe(chatElement, { childList: true });
}

function ensurePromptApiConfigured(settings = ensureSettings()) {
    if (!settings.prompt_api_enabled || !normalizeUrl(settings.prompt_api_url)) {
        throw new Error('请先填写并启用提示词接口。');
    }
}

function populatePromptApiModelSelector() {
    const select = $('#st_chatgpt2api_image_prompt_api_model_select');
    if (!select.length) {
        return;
    }

    const settings = ensureSettings();
    const models = uniqueStrings(Array.isArray(settings.prompt_api_model_options) ? settings.prompt_api_model_options : []);
    const currentModel = String(settings.prompt_api_model || '').trim();
    const options = currentModel && !models.includes(currentModel)
        ? [currentModel, ...models]
        : models;

    select.empty();
    select.append(`<option value="">${options.length ? '从列表中选择模型' : '先拉取模型列表'}</option>`);

    for (const model of options) {
        const label = model === currentModel && !models.includes(currentModel)
            ? `当前模型: ${model}`
            : model;
        select.append($('<option></option>').val(model).text(label));
    }

    select.val(currentModel || '');
}

function refreshDescriptorLibraryUi() {
    if (!$('#st_chatgpt2api_image_settings').length) {
        return;
    }

    if (!$('#st_chatgpt2api_image_card_source_hint').length) {
        $('#st_chatgpt2api_image_current_card_label').after('<small id="st_chatgpt2api_image_card_source_hint" class="st-chatgpt2api-image-help"></small>');
    }

    const cardContext = getCurrentCardContext();
    const cardRecord = getCardLibraryRecord(cardContext);
    const personaContext = getCurrentPersonaContext();
    const personaRecord = getPersonaLibraryRecord(personaContext);

    $('#st_chatgpt2api_image_current_card_label').text(
        cardContext
            ? (cardContext.label + ' · ' + (cardContext.type === 'group' ? '群聊角色卡' : '角色卡'))
            : '未检测到当前角色卡',
    );
    $('#st_chatgpt2api_image_card_source_hint').text(
        cardContext
            ? ('当前卡片源长度 ' + cardContext.sourceText.length + ' 字 · ' + (cardContext.detectionMode === 'group-fallback'
                ? '群聊回退模式'
                : cardContext.detectionMode === 'character-fallback'
                    ? '角色回退模式'
                    : '原生抓取模式'))
            : ('当前聊天没有可用的角色卡正文源。' + buildCardContextDebugSummary()),
    );
    $('#st_chatgpt2api_image_card_library_count').text(
        cardRecord?.entries?.length
            ? ('已存 ' + cardRecord.entries.length + ' 个角色词条')
            : '还没有保存角色词条',
    );
    $('#st_chatgpt2api_image_card_library_text').val(
        cardRecord?.entries?.length ? serializeLibraryEntries(cardRecord.entries) : '[]',
    );

    $('#st_chatgpt2api_image_current_persona_label').text(
        personaContext?.label || '未检测到当前人设',
    );
    $('#st_chatgpt2api_image_persona_library_text').val(
        String(personaRecord?.descriptor || ''),
    );
    $('#st_chatgpt2api_image_persona_source_hint').text(
        personaContext?.sourceDescription
            ? ('当前人设原文长度 ' + personaContext.sourceDescription.length + ' 字')
            : '当前人设原文为空，可手动填写固定描述词。',
    );

    populatePromptApiModelSelector();
}

async function fetchPromptApiModels() {
    const settings = ensureSettings();
    ensurePromptApiConfigured(settings);

    const result = shouldUseSillyTavernPromptProxy(settings)
        ? await requestPromptApiModelsViaSillyTavern(settings)
        : await fetchJsonOrText(getPromptApiModelsUrl(settings), {
            method: 'GET',
            headers: getPromptApiHeaders(settings, { includeContentType: false }),
        });

    const models = extractPromptApiModelIds(result);

    settings.prompt_api_model_options = models;
    if (!String(settings.prompt_api_model || '').trim() && models.length) {
        settings.prompt_api_model = models[0];
    }
    saveSettingsDebounced();
    refreshDescriptorLibraryUi();

    return models;
}

function parseCardLibraryTextarea() {
    const raw = String($('#st_chatgpt2api_image_card_library_text').val() || '').trim();
    if (!raw) {
        return [];
    }

    const parsed = extractJsonPayload(raw);
    const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
    return normalizeLibraryEntries(entries);
}

function buildCardDescriptorExtractionMessages(settings, cardContext, sourceText, { safeMode = false } = {}) {
    const normalizedReference = sanitizeSourceForPromptApi(sourceText, settings);
    const systemRules = [
        getEffectiveCardDescriptorSystemPrompt(settings),
        'Return JSON only with the shape {"entries":[{"name":"","aliases":[""],"descriptor":""}]}',
        'Each entry must represent one recurring character tied to the current card.',
        'Descriptors should focus on stable visual identity, styling, species, apparent adult age, signature items, and overall vibe.',
        'Do not include explicit sexual wording or temporary sex-act details in descriptors.',
    ];

    if (safeMode) {
        systemRules.push('The user content may already be safety-sanitized. Treat it as a faithful identity-preserving rewrite of the original source.');
    }

    if (settings.nsfw_guard_enabled && String(settings.nsfw_rewrite_hint || '').trim()) {
        systemRules.push(`Additional safety guidance: ${String(settings.nsfw_rewrite_hint).trim()}`);
    }

    return [
        {
            role: 'system',
            content: systemRules.join('\n'),
        },
        {
            role: 'user',
            content: [
                `Card label: ${cardContext?.label || ''}`,
                `Card type: ${cardContext?.type || ''}`,
                settings.nsfw_guard_enabled && normalizedReference && normalizedReference !== sourceText
                    ? `Safety-normalized identity reference bundle:\n${normalizedReference}`
                    : '',
                safeMode ? 'Safety-sanitized card and lore source bundle:' : 'Card and lore source bundle:',
                sourceText,
            ].join('\n\n'),
        },
    ];
}

function buildPersonaDescriptorExtractionMessages(settings, personaContext, sourceText, { safeMode = false } = {}) {
    const normalizedReference = sanitizeSourceForPromptApi(sourceText, settings);
    const systemRules = [
        getEffectivePersonaDescriptorSystemPrompt(settings),
        'Return JSON only with the shape {"descriptor":""}.',
        'Focus on stable appearance, styling, aura, and signature features.',
        'Do not include explicit sexual wording or temporary sex-act details.',
    ];

    if (safeMode) {
        systemRules.push('The user content may already be safety-sanitized. Treat it as a faithful identity-preserving rewrite of the original source.');
    }

    if (settings.nsfw_guard_enabled && String(settings.nsfw_rewrite_hint || '').trim()) {
        systemRules.push(`Additional safety guidance: ${String(settings.nsfw_rewrite_hint).trim()}`);
    }

    return [
        {
            role: 'system',
            content: systemRules.join('\n'),
        },
        {
            role: 'user',
            content: [
                `Persona label: ${personaContext?.label || ''}`,
                settings.nsfw_guard_enabled && normalizedReference && normalizedReference !== sourceText
                    ? `Safety-normalized persona reference bundle:\n${normalizedReference}`
                    : '',
                safeMode ? 'Safety-sanitized persona source bundle:' : 'Persona source bundle:',
                sourceText,
            ].join('\n\n'),
        },
    ];
}

async function extractCurrentCardLibrary() {
    const settings = ensureSettings();
    ensurePromptApiConfigured(settings);
    const cardContext = getCurrentCardContext();

    if (!cardContext?.sourceText) {
        throw new Error('当前角色卡没有可提取的内容。');
    }

    const sourceText = await buildCardDescriptorExtractionSource(cardContext);
    if (!sourceText) {
        throw new Error('当前角色卡与世界书内容为空，无法提取角色词条。');
    }

    let result;
    try {
        result = await requestPromptApiChatCompletion(
            settings,
            buildCardDescriptorExtractionMessages(settings, cardContext, sourceText),
            { temperature: 0.2 },
        );
    } catch (error) {
        if (settings.nsfw_guard_enabled && isPromptSafetyBlockError(error)) {
            const safeSource = sanitizeSourceForPromptApi(sourceText, settings);
            result = await requestPromptApiChatCompletion(
                settings,
                buildCardDescriptorExtractionMessages(settings, cardContext, safeSource, { safeMode: true }),
                { temperature: 0.2 },
            );
        } else {
            throw error;
        }
    }

    const payload = extractJsonPayload(getPromptFromPayload(result));
    const entries = normalizeLibraryEntries(Array.isArray(payload) ? payload : payload?.entries);

    if (!entries.length) {
        throw new Error('没有从当前角色卡里识别到可用的角色词条。');
    }

    saveCardLibraryRecord(cardContext, entries);
    saveSettingsDebounced();
    refreshDescriptorLibraryUi();
    return entries;
}

async function extractCurrentPersonaDescriptor() {
    const settings = ensureSettings();
    ensurePromptApiConfigured(settings);
    const personaContext = getCurrentPersonaContext();

    if (!personaContext?.sourceDescription) {
        throw new Error('当前人设原文为空，无法自动提取。');
    }

    const sourceText = await buildPersonaDescriptorExtractionSource(personaContext);
    let result;

    try {
        result = await requestPromptApiChatCompletion(
            settings,
            buildPersonaDescriptorExtractionMessages(settings, personaContext, sourceText),
            { temperature: 0.2 },
        );
    } catch (error) {
        if (settings.nsfw_guard_enabled && isPromptSafetyBlockError(error)) {
            const safeSource = sanitizeSourceForPromptApi(sourceText, settings);
            result = await requestPromptApiChatCompletion(
                settings,
                buildPersonaDescriptorExtractionMessages(settings, personaContext, safeSource, { safeMode: true }),
                { temperature: 0.2 },
            );
        } else {
            throw error;
        }
    }

    const payload = extractJsonPayload(getPromptFromPayload(result));
    const descriptor = normalizeWhitespace(
        typeof payload === 'string'
            ? payload
            : payload?.descriptor || payload?.prompt || '',
    );

    if (!descriptor) {
        throw new Error('没有从当前人设里提取到可用的固定描述词。');
    }

    savePersonaLibraryRecord(personaContext, descriptor);
    saveSettingsDebounced();
    refreshDescriptorLibraryUi();
    return descriptor;
}

async function onFetchPromptModelsClick() {
    setStatus('正在拉取提示词模型列表...', 'busy', '拉取模型');

    try {
        const models = await fetchPromptApiModels();
        const preview = models.slice(0, 8).join(', ');
        const message = models.length
            ? ('提示词模型拉取成功。可用模型：' + preview)
            : '提示词模型接口可访问，但没有返回可解析的模型列表。你仍可手动填写模型名继续使用。';
        setStatus(message, 'success');
        toastr.success(message, TOAST_TITLE);
    } catch (error) {
        console.error('Prompt model fetch failed', error);
        setStatus(`提示词模型拉取失败：${error.message}`, 'error');
        toastr.error(error.message || '未知错误', TOAST_TITLE);
    }
}

async function onExtractCardLibraryClick() {
    setStatus('正在识别当前角色卡中的角色词条，请稍等...', 'busy', '提取角色词条');

    try {
        const entries = await extractCurrentCardLibrary();
        const message = '角色卡词库已更新，共识别 ' + entries.length + ' 个角色词条。';
        setStatus(message, 'success');
        toastr.success(message, TOAST_TITLE);
    } catch (error) {
        console.error('Card library extraction failed', error);
        setStatus(`角色卡词库提取失败：${error.message}`, 'error');
        toastr.error(error.message || '未知错误', TOAST_TITLE);
    }
}

function onSaveCardLibraryClick() {
    try {
        const cardContext = getCurrentCardContext();
        saveCardLibraryRecord(cardContext, parseCardLibraryTextarea());
        saveSettingsDebounced();
        refreshDescriptorLibraryUi();
        const count = getCardLibraryRecord(cardContext)?.entries?.length || 0;
        const message = '当前角色卡词库已保存，共 ' + count + ' 个角色词条。';
        setStatus(message, 'success');
        toastr.success(message, TOAST_TITLE);
    } catch (error) {
        console.error('Card library save failed', error);
        setStatus(`角色卡词库保存失败：${error.message}`, 'error');
        toastr.error(error.message || '未知错误', TOAST_TITLE);
    }
}

function onClearCardLibraryClick() {
    const cardContext = getCurrentCardContext();
    deleteCardLibraryRecord(cardContext);
    saveSettingsDebounced();
    refreshDescriptorLibraryUi();
    setStatus('当前角色卡词库已清空。', 'success');
    toastr.success('当前角色卡词库已清空。', TOAST_TITLE);
}

async function onExtractPersonaLibraryClick() {
    setStatus('正在提取当前用户人设的固定描述词，请稍等...', 'busy', '提取人设词');

    try {
        const descriptor = await extractCurrentPersonaDescriptor();
        const preview = descriptor.length > 120 ? `${descriptor.slice(0, 120)}...` : descriptor;
        setStatus('当前用户人设词已更新。', 'success');
        toastr.success(preview, TOAST_TITLE);
    } catch (error) {
        console.error('Persona descriptor extraction failed', error);
        setStatus(`用户人设词提取失败：${error.message}`, 'error');
        toastr.error(error.message || '未知错误', TOAST_TITLE);
    }
}

function onSavePersonaLibraryClick() {
    try {
        const personaContext = getCurrentPersonaContext();
        const descriptor = String($('#st_chatgpt2api_image_persona_library_text').val() || '').trim();
        savePersonaLibraryRecord(personaContext, descriptor);
        saveSettingsDebounced();
        refreshDescriptorLibraryUi();
        setStatus('当前用户人设词已保存。', 'success');
        toastr.success('当前用户人设词已保存。', TOAST_TITLE);
    } catch (error) {
        console.error('Persona descriptor save failed', error);
        setStatus(`用户人设词保存失败：${error.message}`, 'error');
        toastr.error(error.message || '未知错误', TOAST_TITLE);
    }
}

function onClearPersonaLibraryClick() {
    const personaContext = getCurrentPersonaContext();
    deletePersonaLibraryRecord(personaContext);
    saveSettingsDebounced();
    refreshDescriptorLibraryUi();
    setStatus('当前用户人设词已清空。', 'success');
    toastr.success('当前用户人设词已清空。', TOAST_TITLE);
}

async function onTestApiClick() {
    const settings = ensureSettings();
    const modelsUrl = buildOpenAiCompatibleEndpointUrl(settings.image_api_url, '/models');

    if (!modelsUrl) {
        setStatus('请先填写生图接口地址。', 'error');
        return;
    }

    setStatus('正在测试生图接口...', 'busy', '测试接口');

    try {
        const headers = {};
        if (settings.image_api_key.trim()) {
            headers.Authorization = `Bearer ${settings.image_api_key.trim()}`;
        }

        const result = await fetchJsonOrText(modelsUrl, {
            method: 'GET',
            headers,
        });

        const models = Array.isArray(result?.data) ? result.data.map(item => item?.id).filter(Boolean) : [];
        const preview = models.slice(0, 6).join(', ');
        const message = models.length ? ('生图接口连接正常。可用模型：' + preview) : '生图接口连接正常。';

        setStatus(message, 'success');
        toastr.success(message, TOAST_TITLE);
    } catch (error) {
        console.error('ChatGPT2API image API test failed', error);
        setStatus(`生图接口测试失败：${error.message}`, 'error');
        toastr.error(error.message || '未知错误', TOAST_TITLE);
    }
}

function bindSettingInput(selector, key, transform = value => value) {
    $(document).on('input change', selector, function () {
        ensureSettings()[key] = transform($(this).val());
        saveSettingsDebounced();
    });
}

function loadSettingsIntoUi() {
    const settings = ensureSettings();

    $('#st_chatgpt2api_image_enabled').prop('checked', settings.enabled !== false);
    $('#st_chatgpt2api_image_connection_mode').val(settings.connection_mode || 'browser');
    $('#st_chatgpt2api_image_prompt_api_enabled').prop('checked', settings.prompt_api_enabled);
    $('#st_chatgpt2api_image_prompt_api_mode').val(settings.prompt_api_mode);
    $('#st_chatgpt2api_image_prompt_api_url').val(settings.prompt_api_url);
    $('#st_chatgpt2api_image_prompt_api_key').val(settings.prompt_api_key);
    $('#st_chatgpt2api_image_prompt_api_model').val(settings.prompt_api_model);
    $('#st_chatgpt2api_image_prompt_api_system_prompt').val(getPromptAssistantSystemPrompt(settings));
    $('#st_chatgpt2api_image_descriptor_card_system_prompt').val(getCardDescriptorSystemPrompt(settings));
    $('#st_chatgpt2api_image_descriptor_persona_system_prompt').val(getPersonaDescriptorSystemPrompt(settings));
    $('#st_chatgpt2api_image_api_url').val(settings.image_api_url);
    $('#st_chatgpt2api_image_api_key').val(settings.image_api_key);
    $('#st_chatgpt2api_image_model').val(settings.image_model);
    $('#st_chatgpt2api_image_nsfw_guard_enabled').prop('checked', settings.nsfw_guard_enabled);
    $('#st_chatgpt2api_image_nsfw_terms').val(settings.nsfw_terms);
    $('#st_chatgpt2api_image_nsfw_rewrite_hint').val(settings.nsfw_rewrite_hint);
    $('#st_chatgpt2api_image_debug').prop('checked', settings.debug);
    updateConnectionModeUi(settings);
    refreshDescriptorLibraryUi();
}

async function addSettingsUi() {
    if ($('#st_chatgpt2api_image_settings').length) {
        attachSettingsContentToControlPanel();
        return;
    }

    const settingsHtml = await renderExtensionTemplateAsync(EXTENSION_NAME, 'settings');
    $('#extensions_settings2').append(settingsHtml);

    loadSettingsIntoUi();
    attachSettingsContentToControlPanel();

    $(document).on('change', '#st_chatgpt2api_image_prompt_api_enabled', function () {
        ensureSettings().prompt_api_enabled = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $(document).on('change', '#st_chatgpt2api_image_enabled', function () {
        ensureSettings().enabled = !!$(this).prop('checked');
        saveSettingsDebounced();
        applyInlineButtonEnabledState(ensureSettings().enabled);
    });

    $(document).on('change', '#st_chatgpt2api_image_connection_mode', function () {
        ensureSettings().connection_mode = String($(this).val() || 'browser');
        updateConnectionModeUi();
        saveSettingsDebounced();
    });

    $(document).on('change', '#st_chatgpt2api_image_prompt_api_mode', function () {
        ensureSettings().prompt_api_mode = String($(this).val() || 'openai');
        saveSettingsDebounced();
    });

    $(document).on('change', '#st_chatgpt2api_image_debug', function () {
        ensureSettings().debug = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $(document).on('change', '#st_chatgpt2api_image_nsfw_guard_enabled', function () {
        ensureSettings().nsfw_guard_enabled = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    bindSettingInput('#st_chatgpt2api_image_prompt_api_url', 'prompt_api_url', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_prompt_api_key', 'prompt_api_key', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_prompt_api_system_prompt', 'prompt_api_system_prompt', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_descriptor_card_system_prompt', 'descriptor_card_system_prompt', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_descriptor_persona_system_prompt', 'descriptor_persona_system_prompt', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_api_url', 'image_api_url', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_api_key', 'image_api_key', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_model', 'image_model', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_nsfw_terms', 'nsfw_terms', value => String(value || ''));
    bindSettingInput('#st_chatgpt2api_image_nsfw_rewrite_hint', 'nsfw_rewrite_hint', value => String(value || ''));

    $(document).on('input change', '#st_chatgpt2api_image_prompt_api_model', function () {
        ensureSettings().prompt_api_model = String($(this).val() || '');
        saveSettingsDebounced();
        populatePromptApiModelSelector();
    });

    $(document).on('change', '#st_chatgpt2api_image_prompt_api_model_select', function () {
        const value = String($(this).val() || '');
        ensureSettings().prompt_api_model = value;
        $('#st_chatgpt2api_image_prompt_api_model').val(value);
        saveSettingsDebounced();
        populatePromptApiModelSelector();
    });

    $(document).on('click', '#st_chatgpt2api_image_test_api', onTestApiClick);
    $(document).on('click', '#st_chatgpt2api_image_reset_prompt_system_prompt', function () {
        ensureSettings().prompt_api_system_prompt = DEFAULT_PROMPT_API_SYSTEM_PROMPT;
        $('#st_chatgpt2api_image_prompt_api_system_prompt').val(DEFAULT_PROMPT_API_SYSTEM_PROMPT);
        saveSettingsDebounced();
        setStatus('提词助手设定已恢复默认。', 'success');
    });
    $(document).on('click', '#st_chatgpt2api_image_reset_descriptor_card_system_prompt', function () {
        ensureSettings().descriptor_card_system_prompt = DEFAULT_CARD_DESCRIPTOR_SYSTEM_PROMPT;
        $('#st_chatgpt2api_image_descriptor_card_system_prompt').val(DEFAULT_CARD_DESCRIPTOR_SYSTEM_PROMPT);
        saveSettingsDebounced();
        setStatus('角色词条提取设定已恢复默认。', 'success');
    });
    $(document).on('click', '#st_chatgpt2api_image_reset_descriptor_persona_system_prompt', function () {
        ensureSettings().descriptor_persona_system_prompt = DEFAULT_PERSONA_DESCRIPTOR_SYSTEM_PROMPT;
        $('#st_chatgpt2api_image_descriptor_persona_system_prompt').val(DEFAULT_PERSONA_DESCRIPTOR_SYSTEM_PROMPT);
        saveSettingsDebounced();
        setStatus('人设词条提取设定已恢复默认。', 'success');
    });
    $(document).on('click', '#st_chatgpt2api_image_fetch_prompt_models', onFetchPromptModelsClick);
    $(document).on('click', '#st_chatgpt2api_image_extract_card_library', onExtractCardLibraryClick);
    $(document).on('click', '#st_chatgpt2api_image_save_card_library', onSaveCardLibraryClick);
    $(document).on('click', '#st_chatgpt2api_image_clear_card_library', onClearCardLibraryClick);
    $(document).on('click', '#st_chatgpt2api_image_extract_persona_library', onExtractPersonaLibraryClick);
    $(document).on('click', '#st_chatgpt2api_image_save_persona_library', onSavePersonaLibraryClick);
    $(document).on('click', '#st_chatgpt2api_image_clear_persona_library', onClearPersonaLibraryClick);
}

function bindMessageActionEvents() {
    $(document).on('click', MESSAGE_BUTTON_SELECTOR, async function (event) {
        event.preventDefault();
        event.stopPropagation();

        await addFloatingPanel();
        selectMessage($(this).attr('data-st-message-id'));
    });
}

function bindChatLifecycleEvents() {
    eventSource.on(event_types.IMAGE_SWIPED, onInlineImageSwiped);

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
        const normalizedId = normalizeMessageId(messageId);
        if (normalizedId === null) {
            return;
        }

        syncMessageActionButton(normalizedId);
        syncMessageExtraToCurrentSwipe(normalizedId, { persist: true });
        scheduleMessageMediaRefresh(normalizedId, { retryBrokenImage: true });
        updateInteractiveState();
    });

    eventSource.on(event_types.MESSAGE_UPDATED, async (messageId) => {
        const normalizedId = normalizeMessageId(messageId);
        if (normalizedId === null) {
            return;
        }

        syncMessageActionButton(normalizedId);
        syncMessageExtraToCurrentSwipe(normalizedId, { persist: true });
        scheduleMessageMediaRefresh(normalizedId, { retryBrokenImage: true });
        if (normalizedId === runtimeState.selectedMessageId) {
            updatePanelSelection(false);
        }
    });

    eventSource.on(event_types.MESSAGE_SWIPED, async (messageId) => {
        const normalizedId = normalizeMessageId(messageId);
        if (normalizedId === null) {
            return;
        }

        syncMessageActionButton(normalizedId);
        syncMessageExtraToCurrentSwipe(normalizedId, { persist: true });
        scheduleMessageMediaRefresh(normalizedId, { retryBrokenImage: true });
        if (normalizedId === runtimeState.selectedMessageId) {
            updatePanelSelection(false);
        }
    });

    eventSource.on(event_types.MESSAGE_DELETED, async () => {
        if (!getMessageById(runtimeState.selectedMessageId)) {
            runtimeState.selectedMessageId = null;
            updatePanelSelection(true);
            closeFloatingPanel();
        }
        scheduleSyncAllMessageActionButtons();
        refreshDescriptorLibraryUi();
    });

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        runtimeState.selectedMessageId = null;
        updatePanelSelection(true);
        closeFloatingPanel();
        repairCurrentChatImageSwipeMetadata();
        scheduleSyncAllMessageActionButtons();
        refreshDescriptorLibraryUi();
    });
}

jQuery(async function () {
    ensureSettings();
    await addSettingsUi();
    await addControlPanel();
    await addFloatingPanel();
    bindMessageActionEvents();
    bindChatLifecycleEvents();
    observeChatMutations();
    repairCurrentChatImageSwipeMetadata();
    scheduleSyncAllMessageActionButtons();
    window.setTimeout(repairCurrentChatImageSwipeMetadata, 400);
    window.setTimeout(repairCurrentChatImageSwipeMetadata, 1400);
    window.setTimeout(scheduleSyncAllMessageActionButtons, 600);
    window.setTimeout(scheduleSyncAllMessageActionButtons, 1800);
    window.setTimeout(refreshDescriptorLibraryUi, 600);
    window.setTimeout(refreshDescriptorLibraryUi, 1800);
    window.setTimeout(refreshDescriptorLibraryUi, 3600);
    window.setTimeout(() => applyInlineButtonEnabledState(isInlineImageButtonEnabled()), 0);
    setStatus('选中一条消息后即可开始。');
});
