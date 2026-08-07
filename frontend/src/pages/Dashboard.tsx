import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Chip, CircularProgress, TextField,
  Stack, IconButton, Paper, Grid, Select, MenuItem, FormControl, InputLabel, Divider,
  Switch, FormControlLabel, Checkbox, Dialog, DialogTitle, DialogContent, DialogActions, Link,
  Badge, Popover, Avatar, Alert, LinearProgress, ToggleButton, ToggleButtonGroup,
  Accordion, AccordionSummary, AccordionDetails, FormHelperText, Tooltip,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/EditOutlined';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import QrCodeIcon from '@mui/icons-material/QrCode';
import DialpadIcon from '@mui/icons-material/Dialpad';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import ChatIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import KnowledgeIcon from '@mui/icons-material/MenuBookOutlined';
import CampaignIcon from '@mui/icons-material/CampaignOutlined';
import CalendarIcon from '@mui/icons-material/EventAvailableOutlined';
import RuleIcon from '@mui/icons-material/RuleOutlined';
import TemplateIcon from '@mui/icons-material/TextSnippetOutlined';
import FollowUpIcon from '@mui/icons-material/ScheduleSendOutlined';
import ShieldIcon from '@mui/icons-material/ShieldOutlined';
import ContactsIcon from '@mui/icons-material/ContactsOutlined';
import PersonIcon from '@mui/icons-material/Person';
import { QRCodeSVG } from 'qrcode.react';
import logo from '../assets/logo-slaludiskon.png';
import api from '../services/api';
import { swalConfirm, swalAlert, swalToast } from '../services/swal';
import SettingsIcon from '@mui/icons-material/Settings';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import LanguageIcon from '@mui/icons-material/LanguageOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MarkChatReadIcon from '@mui/icons-material/MarkChatReadOutlined';

import InboxPanel from '../components/InboxPanel';
import TestChatPanel from '../components/TestChatPanel';
import BroadcastPanel from '../components/BroadcastPanel';
import CalendarPanel from '../components/CalendarPanel';
import AutoReplyPanel from '../components/AutoReplyPanel';
import FlowPanel from '../components/FlowPanel';
import ApiPanel from '../components/ApiPanel';
import ApiIcon from '@mui/icons-material/ApiOutlined';
import WidgetPanel from '../components/WidgetPanel';
import WidgetsIcon from '@mui/icons-material/WidgetsOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTreeOutlined';
import TemplatePanel from '../components/TemplatePanel';
import ContactsPanel from '../components/ContactsPanel';
import FollowUpPanel from '../components/FollowUpPanel';
import ProductPanel from '../components/ProductPanel';
import GroupGuardPanel from '../components/GroupGuardPanel';
import StatusPanel from '../components/StatusPanel';
import AutoStoriesIcon from '@mui/icons-material/AutoStoriesOutlined';
import PageHeader from '../components/PageHeader';
import {
  useAgents, useAgentStatuses, useAgentStatus, useAgentKnowledge,
  useCreateAgent, useDeleteAgent, useSaveAgent, useAgentConnect, useAgentDisconnect,
  useAddKnowledge, useDeleteKnowledge, useUpdateKnowledge, useDeleteAllKnowledge, useGenerateKnowledge,
  useAgentHandoffs, useResumeHandoff,
  useCrawlStatus, useKnowledgeUsage, useStartCrawl, useTrainCrawlPages,
  useRegeneratePersona, useStopTraining,
  useAgentConnectPairing,
  useAIForms, useSaveAIForm, useDeleteAIForm, useAIFormSubmissions,
} from '../hooks';

import type { Agent, KnowledgeItem, AIForm, AIFormStepConfig, AIFormStepType } from '../types';

type AgentAIView = 'overview' | 'persona' | 'knowledge' | 'forms';

type AgentSettingsDraft = {
  name: string;
  system_prompt: string;
  tone: string;
  auto_read: boolean;
  ai_reply_delay_min: number;
  ai_reply_delay_max: number;
  greeting_enabled: boolean;
  greeting_message: string;
  business_hours_enabled: boolean;
  business_start: string;
  business_end: string;
  away_message: string;
};

type EmbeddingModelOption = {
  id: string;
  name: string;
  context_length?: number;
};

const defaultAIFormSteps = (): AIFormStepConfig[] => [
  { key: 'name', label: 'Boleh dibantu nama lengkapnya?', type: 'text', required: true },
  { key: 'need', label: 'Kebutuhan atau kendalanya apa?', type: 'text', required: true },
  { key: 'schedule', label: 'Kapan waktu yang diinginkan?', type: 'text', required: false },
  { key: 'note', label: 'Ada catatan tambahan? Ketik lewati jika tidak ada.', type: 'text', required: false },
];

function parseAIFormJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function cleanAIFormKey(value: string, fallback: string) {
  const cleaned = value.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return cleaned || fallback;
}

function settingsFromAgent(agent: Agent): AgentSettingsDraft {
  return {
    name: agent.name || '',
    system_prompt: agent.system_prompt || '',
    tone: agent.tone || 'ramah',
    auto_read: !!agent.auto_read,
    ai_reply_delay_min: agent.ai_reply_delay_min ?? 4,
    ai_reply_delay_max: agent.ai_reply_delay_max ?? 8,
    greeting_enabled: !!agent.greeting_enabled,
    greeting_message: agent.greeting_message || '',
    business_hours_enabled: !!agent.business_hours_enabled,
    business_start: agent.business_start || '08:00',
    business_end: agent.business_end || '21:00',
    away_message: agent.away_message || '',
  };
}

function settingsKey(settings: AgentSettingsDraft) {
  // auto_read disimpan langsung dari Dashboard, jadi tidak ikut indikator
  // "perubahan belum disimpan" pada form Pengaturan.
  const { auto_read: _autoRead, ...formSettings } = settings;
  return JSON.stringify(formSettings);
}

const TONES = [
  { value: 'ramah', label: '😊 Ramah' },
  { value: 'formal', label: '👔 Formal' },
  { value: 'santai', label: '🏖️ Santai' },
  { value: 'persuasif', label: '💪 Persuasif' },
  { value: 'custom', label: '✏️ Ikuti Persona' },
];

const KNOWLEDGE_SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  wizard: 'Setup Cepat',
  web: 'Website',
  text: 'Tulis Info',
  import: 'Impor',
};

type AssistantQualityCheck = { label: string; ready: boolean };

function containsAny(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.some(term => normalized.includes(term));
}

function personaQualityChecks(persona: string): AssistantQualityCheck[] {
  return [
    { label: 'Peran dan identitas', ready: containsAny(persona, ['kamu adalah', 'asisten', 'customer service', 'cs ']) },
    { label: 'Ruang lingkup bantuan', ready: containsAny(persona, ['bantu', 'produk', 'layanan', 'pelanggan']) },
    { label: 'Batasan agar tidak mengarang', ready: containsAny(persona, ['jangan', 'tidak boleh', 'hanya berdasarkan', 'basis pengetahuan']) },
    { label: 'Respons saat data tidak tersedia', ready: containsAny(persona, ['tidak tahu', 'belum tersedia', 'belum ada data', 'manusia', 'handoff']) },
  ];
}

function knowledgeQuality(items: KnowledgeItem[]) {
  const tagged = items.filter(item => !!item.tags?.trim()).length;
  const detailed = items.filter(item => item.answer.trim().length >= 25).length;
  const sources = new Set(items.map(item => item.source || 'manual'));
  const corpus = items.map(item => `${item.question} ${item.answer} ${item.tags || ''}`).join(' ').toLowerCase();
  const topics = [
    { label: 'Produk/layanan', ready: containsAny(corpus, ['produk', 'layanan', 'jasa']) },
    { label: 'Harga/biaya', ready: containsAny(corpus, ['harga', 'biaya', 'tarif']) },
    { label: 'Cara order', ready: containsAny(corpus, ['order', 'pesan', 'pemesanan', 'booking', 'beli']) },
    { label: 'Pengiriman/akses', ready: containsAny(corpus, ['kirim', 'ongkir', 'pengiriman', 'download', 'akses']) },
    { label: 'Jam/lokasi/kebijakan', ready: containsAny(corpus, ['jam', 'lokasi', 'alamat', 'garansi', 'refund', 'kebijakan']) },
  ];
  const suggestions: string[] = [];
  if (items.length === 0) suggestions.push('Tambahkan pengetahuan pertama agar AI punya sumber jawaban.');
  else {
    if (items.length < 5) suggestions.push('Tambahkan beberapa pertanyaan pelanggan yang paling sering muncul.');
    if (tagged < items.length) suggestions.push(`${items.length - tagged} FAQ belum memiliki tag pencarian.`);
    if (detailed < items.length) suggestions.push(`${items.length - detailed} jawaban masih sangat singkat dan bisa dibuat lebih jelas.`);
    if (!topics.some(topic => topic.ready)) suggestions.push('Tambahkan topik produk, harga, order, atau layanan utama.');
  }
  return { tagged, detailed, sourceCount: sources.size, topics, suggestions };
}

const NAV_GROUPS = [
  { section: '', items: [
    { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon fontSize="small" /> },
  ] },
  { section: 'Percakapan', items: [
    { id: 'inbox', label: 'Inbox', icon: <InboxIcon fontSize="small" /> },
    { id: 'kontak', label: 'Kontak', icon: <ContactsIcon fontSize="small" /> },
    { id: 'handoff', label: 'Butuh CS', icon: <SupportAgentIcon fontSize="small" /> },
  ] },
  { section: 'AI & Otomasi', items: [
    { id: 'agent-ai', label: 'Asisten AI', icon: <SmartToyIcon fontSize="small" /> },
    { id: 'auto-reply', label: 'Auto-Reply', icon: <RuleIcon fontSize="small" /> },
    { id: 'alur', label: 'Alur Otomatis', icon: <AccountTreeIcon fontSize="small" /> },
    { id: 'template', label: 'Template', icon: <TemplateIcon fontSize="small" /> },
    { id: 'produk', label: 'Produk', icon: <KnowledgeIcon fontSize="small" /> },
    { id: 'coba-chat', label: 'Simulasi AI', icon: <ChatIcon fontSize="small" /> },
  ] },
  { section: 'Grup', items: [
    { id: 'grup', label: 'Anti-Spam Grup', icon: <ShieldIcon fontSize="small" /> },
  ] },
  { section: 'Kampanye', items: [
    { id: 'broadcast', label: 'Blast', icon: <CampaignIcon fontSize="small" /> },
    { id: 'kalender', label: 'Jadwal Blast', icon: <CalendarIcon fontSize="small" /> },
    { id: 'status', label: 'Status / Story', icon: <AutoStoriesIcon fontSize="small" /> },
    { id: 'follow-up', label: 'Follow-up', icon: <FollowUpIcon fontSize="small" /> },
  ] },
  { section: 'Akun', items: [
    { id: 'ai-model', label: 'AI & Model', icon: <AutoAwesomeIcon fontSize="small" /> },
    { id: 'widget', label: 'Widget & Link', icon: <WidgetsIcon fontSize="small" /> },
    { id: 'api', label: 'REST API', icon: <ApiIcon fontSize="small" /> },
    { id: 'settings', label: 'Pengaturan', icon: <SettingsIcon fontSize="small" /> },
    
  ] },
];
const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);

export default function Dashboard() {
  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem('wai_tab');
    const normalized = saved === 'knowledge' ? 'agent-ai' : saved;
    const valid = !!normalized && NAV_ITEMS.some(n => n.id === normalized);
    return valid && normalized ? normalized : 'dashboard';
  });
  const [agentAIView, setAgentAIView] = useState<AgentAIView>(() =>
    localStorage.getItem('wai_tab') === 'knowledge' ? 'knowledge' : 'overview');
  // seed = data yang dioper antar-tab (mis. dari Kontak ke Broadcast/Inbox). n = pemicu agar efek jalan ulang.
  const [seed, setSeed] = useState<{ kind: 'broadcast' | 'inbox'; value: string; n: number } | null>(null);
  const [agentId, setAgentId] = useState<number>(() => Number(localStorage.getItem('wai_agent')) || 0);
  const [agentName, setAgentName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('ramah');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [autoRead, setAutoRead] = useState(false);
  const [showGuardModal, setShowGuardModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [guardMissing, setGuardMissing] = useState<string[]>([]);
  const [settingsBaseline, setSettingsBaseline] = useState<string | null>(null);
  const [greetEnabled, setGreetEnabled] = useState(false);
  const [greetMsg, setGreetMsg] = useState('');
  const [bhEnabled, setBhEnabled] = useState(false);
  const [bhStart, setBhStart] = useState('08:00');
  const [bhEnd, setBhEnd] = useState('21:00');
  const [awayMsg, setAwayMsg] = useState('');
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [newTags, setNewTags] = useState('');
  const [genText, setGenText] = useState('');
  const [genCount, setGenCount] = useState(10);
  const [knowledgePage, setKnowledgePage] = useState(0);
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeListSource, setKnowledgeListSource] = useState('');
  const [knowledgeSource, setKnowledgeSource] = useState<'wizard' | 'web' | 'text' | 'manual'>('wizard');
  const [knowledgeErrors, setKnowledgeErrors] = useState<Record<string, string>>({});
  const [editingKnowledge, setEditingKnowledge] = useState<KnowledgeItem | null>(null);
  const [editingKnowledgeDraft, setEditingKnowledgeDraft] = useState({ question: '', answer: '', tags: '' });
  const [editingAIForm, setEditingAIForm] = useState<AIForm | null>(null);
  const [aiFormName, setAIFormName] = useState('');
  const [aiFormGoal, setAIFormGoal] = useState('');
  const [aiFormHints, setAIFormHints] = useState('');
  const [aiFormSteps, setAIFormSteps] = useState<AIFormStepConfig[]>(defaultAIFormSteps);
  const [aiFormEnabled, setAIFormEnabled] = useState(true);
  const [aiFormHandoff, setAIFormHandoff] = useState(true);
  const [aiFormSuccess, setAIFormSuccess] = useState('Data *{code}* berhasil dicatat. CS kami akan menindaklanjuti.');
  const [aiFormErrors, setAIFormErrors] = useState<Record<string, string>>({});
  const KNOWLEDGE_PER_PAGE = 10;
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [aiReplyDelayMin, setAIReplyDelayMin] = useState(4);
  const [aiReplyDelayMax, setAIReplyDelayMax] = useState(8);
  const currentSettings = useMemo<AgentSettingsDraft>(() => ({
    name: agentName,
    system_prompt: prompt,
    tone,
    auto_read: autoRead,
    ai_reply_delay_min: aiReplyDelayMin,
    ai_reply_delay_max: aiReplyDelayMax,
    greeting_enabled: greetEnabled,
    greeting_message: greetMsg,
    business_hours_enabled: bhEnabled,
    business_start: bhStart,
    business_end: bhEnd,
    away_message: awayMsg,
  }), [agentName, prompt, tone, autoRead, aiReplyDelayMin, aiReplyDelayMax, greetEnabled, greetMsg, bhEnabled, bhStart, bhEnd, awayMsg]);
  const hasUnsavedSettings = settingsBaseline !== null && settingsKey(currentSettings) !== settingsBaseline;
  // Setup Wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardBiz, setWizardBiz] = useState({
    biz_name: '', biz_type: 'produk_fisik', products: '', price_range: '', order_flow: '',
    payment: '', shipping: '', location: '', hours: '08:00-21:00', policies: '', cs_name: '',
  });
  const [wizardLoading, setWizardLoading] = useState(false);
  const user = JSON.parse(localStorage.getItem('user') || '{}') as { name?: string; username?: string; email?: string; role?: string; phone?: string };
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [addError, setAddError] = useState('');
  const [profileName, setProfileName] = useState(user.name || '');
  const [profileOldPassword, setProfileOldPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [chatProvider, setChatProvider] = useState('deepseek-direct'); // deepseek-direct | openrouter
  const [apiModel, setApiModel] = useState('deepseek/deepseek-chat');
  const [deepseekModel, setDeepseekModel] = useState('deepseek-chat');
  const [visionModel, setVisionModel] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('openai/text-embedding-3-small');
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelOption[]>([]);
  const [embeddingModelsLoading, setEmbeddingModelsLoading] = useState(false);
  const [embeddingModelsError, setEmbeddingModelsError] = useState('');
  const [chatModels, setChatModels] = useState<EmbeddingModelOption[]>([]);
  const [chatModelsLoading, setChatModelsLoading] = useState(false);
  const [chatModelsError, setChatModelsError] = useState('');
  const [visionModels, setVisionModels] = useState<EmbeddingModelOption[]>([]);
  const [visionModelsLoading, setVisionModelsLoading] = useState(false);
  const [visionModelsError, setVisionModelsError] = useState('');
  const [exampleModalOpen, setExampleModalOpen] = useState(false);
  const [exampleMode, setExampleMode] = useState<'prompt' | 'profile'>('prompt');

  const openAgentAI = (view: AgentAIView = 'overview') => {
    setAgentAIView(view);
    setTab('agent-ai');
  };

  // ---- TanStack Query: data fetching + auto-polling, tanpa useEffect/setInterval manual ----

  const { data: agents = [], refetch: refetchAgents } = useAgents();
  const { data: statusMap = {} } = useAgentStatuses();
  const { data: statusData } = useAgentStatus(agentId);
  const { data: knowledge = [], refetch: refetchKnowledge } = useAgentKnowledge(agentId);
  const personaChecks = useMemo(() => personaQualityChecks(prompt), [prompt]);
  const knowledgeHealth = useMemo(() => knowledgeQuality(knowledge), [knowledge]);
  const knowledgeSources = useMemo(() => Array.from(new Set(knowledge.map(item => item.source || 'manual'))).sort(), [knowledge]);
  const filteredKnowledge = useMemo(() => {
    const query = knowledgeQuery.trim().toLowerCase();
    return knowledge.filter(item => {
      if (knowledgeListSource && (item.source || 'manual') !== knowledgeListSource) return false;
      if (!query) return true;
      return `${item.question} ${item.answer} ${item.tags || ''}`.toLowerCase().includes(query);
    });
  }, [knowledge, knowledgeListSource, knowledgeQuery]);
  const { data: handoffs = [] } = useAgentHandoffs(agentId);
  const resumeHandoff = useResumeHandoff(agentId);


  const status = statusData?.status || '';
  const qr = statusData?.qr || '';
  const qrTtl = statusData?.qr_ttl || 0;
  const pairCode = statusData?.pair_code || '';
  const pairError = statusData?.pair_error || '';
  const waNumber = statusData?.number || '';
  const waName = statusData?.name || '';

  // ---- Mutations (TanStack Query) ----

  const connectMut = useAgentConnect(agentId);
  const pairMut = useAgentConnectPairing(agentId);
  const disconnectMut = useAgentDisconnect(agentId);
  const saveAgentMut = useSaveAgent(agentId);
  const createAgentMut = useCreateAgent();
  const deleteAgentMut = useDeleteAgent();
  const addKnowledgeMut = useAddKnowledge(agentId);
  const deleteKnowledgeMut = useDeleteKnowledge(agentId);
  const updateKnowledgeMut = useUpdateKnowledge(agentId);
  const deleteAllKnowledgeMut = useDeleteAllKnowledge(agentId);
  const generateKnowledgeMut = useGenerateKnowledge(agentId);
  const { data: aiForms = [] } = useAIForms(agentId);
  const { data: aiFormSubmissions = [] } = useAIFormSubmissions(agentId);
  const saveAIFormMut = useSaveAIForm(agentId);
  const deleteAIFormMut = useDeleteAIForm(agentId);

  // ---- Latih dari Website (crawl) ----
  const { data: crawlData } = useCrawlStatus(agentId);
  const { data: kbUsage } = useKnowledgeUsage(agentId);
  const startCrawlMut = useStartCrawl(agentId);
  const trainCrawlMut = useTrainCrawlPages(agentId);
  const regenPersonaMut = useRegeneratePersona(agentId);
  const stopTrainMut = useStopTraining(agentId);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const crawlJob = crawlData?.job ?? null;
  const crawlPages = crawlData?.pages ?? [];
  const isTraining = crawlJob?.status === 'training' || crawlJob?.status === 'stopping';
  const trainedCount = crawlPages.filter(p => p.status === 'trained').length;
  const skippedCount = crawlPages.filter(p => p.status === 'skipped').length;
  const failedTrainCount = crawlPages.filter(p => p.status === 'failed' && p.char_count > 0).length;
  // Pelatihan selesai bila job idle tapi sudah ada halaman yang diproses (dilatih/dilewati/gagal).
  const trainingDone = !isTraining && (trainedCount > 0 || skippedCount > 0 || failedTrainCount > 0);

  // Popup "Pelatihan selesai" saat status job berubah dari proses-latih -> selesai (biar kebaca dulu).
  const prevTrainStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = crawlJob?.status;
    const prev = prevTrainStatus.current;
    prevTrainStatus.current = s;
    if ((prev === 'training' || prev === 'stopping') && (s === 'done' || s === 'failed')) {
      const detail = `${trainedCount} halaman dilatih`
        + (skippedCount ? `, ${skippedCount} dilewati (AI menilai cuma navigasi/tanpa info pelanggan)` : '')
        + (failedTrainCount ? `, ${failedTrainCount} gagal` : '')
        + (crawlJob?.persona_updated ? ', persona diperbarui otomatis' : '')
        + (crawlJob?.persona_error ? `, persona belum diperbarui: ${crawlJob.persona_error}` : '')
        + '. FAQ tersimpan di daftar Knowledge di bawah.';
      void refetchAgents();
      swalAlert('Pelatihan selesai', trainedCount > 0 ? 'success' : 'warning', detail);
    }
  }, [crawlJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-pilih halaman rekomendasi sekali tiap kali crawl baru selesai (biar user tinggal klik "Latih").
  const autoPickedJob = useRef<number | null>(null);
  useEffect(() => {
    if (!crawlJob || crawlJob.status !== 'done') return;
    if (autoPickedJob.current === crawlJob.id) return;
    const recommended = crawlPages.filter(p => p.recommended && p.status === 'crawled').map(p => p.id);
    if (recommended.length > 0) setSelectedPages(recommended);
    autoPickedJob.current = crawlJob.id;
  }, [crawlJob, crawlPages]);

  const startCrawl = async () => {
    const u = crawlUrl.trim();
    if (!u) return;
    try {
      await startCrawlMut.mutateAsync(u);
      setSelectedPages([]);
      swalToast('Crawl dimulai, tunggu hasilnya…', 'success');
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Gagal memulai crawl';
      swalToast(msg, 'error');
    }
  };

  const trainSelected = async () => {
    if (!crawlJob || selectedPages.length === 0) return;
    try {
      await trainCrawlMut.mutateAsync({ jobId: crawlJob.id, pageIds: selectedPages, updatePersona: false });
      setSelectedPages([]);
      swalToast('Pelatihan dimulai. AI sedang merangkum halaman jadi FAQ…', 'success');
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Gagal memulai pelatihan';
      swalToast(msg, 'error');
    }
  };

  const stopTraining = async () => {
    if (!crawlJob) return;
    try {
      await stopTrainMut.mutateAsync(crawlJob.id);
      swalToast('Menghentikan pelatihan… halaman yang sudah jadi tetap tersimpan', 'success');
    } catch {
      swalToast('Gagal menghentikan pelatihan', 'error');
    }
  };

  const regeneratePersona = async () => {
    if (!await swalConfirm('Susun ulang persona dari website?', 'Persona saat ini akan diganti berdasarkan konten website terakhir yang sudah dilatih.')) return;
    try {
      await regenPersonaMut.mutateAsync();
      swalToast('Persona berhasil diperbarui dari website', 'success');
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Gagal membuat persona';
      swalToast(msg, 'error');
    }
  };

  const applySafePersonaTemplate = async () => {
    if (prompt.trim() && !await swalConfirm('Ganti persona dengan kerangka aman?', 'Persona saat ini akan diganti di editor. Perubahan baru tersimpan setelah menekan Simpan Persona.')) return;
    const assistant = agentName.trim() || 'asisten customer service';
    setPrompt(`Kamu adalah ${assistant} untuk bisnis ini. Bantu pelanggan memahami produk atau layanan, memilih yang sesuai, dan mengikuti proses pemesanan. Gunakan hanya fakta bisnis yang tersedia dan memori percakapan pelanggan. Jangan mengarang harga, stok, promo, kebijakan, atau janji layanan. Tanyakan hanya informasi yang memang belum diberikan pelanggan. Jika informasi belum tersedia, sebutkan bagian yang belum bisa dipastikan secara natural tanpa langsung mengalihkan ke manusia. Dalam balasan pelanggan, berbicaralah sebagai staf bisnis dan jangan pernah menyebut AI, bot, model, sistem, database, data saya, knowledge, basis pengetahuan, prompt, atau cara memperoleh jawaban. Teruskan ke petugas hanya jika pelanggan memintanya atau ada keputusan berisiko yang tidak boleh kamu putuskan. Jaga jawaban tetap ringkas, nyambung, dan fokus pada langkah paling relevan.`);
  };

  const runSetupWizard = async () => {
    if (knowledge.length > 0) {
      const confirmed = await swalConfirm(
        'Perbarui hasil Setup Cepat?',
        'Hanya FAQ dari Setup Cepat sebelumnya yang akan diganti. FAQ Website, Tulis Info, dan Manual tetap tersimpan.',
      );
      if (!confirmed) return;
    }

    setWizardLoading(true);
    try {
      const res = await api.post(`/agents/${agentId}/setup-wizard`, wizardBiz);
      setPrompt(res.data.system_prompt || '');
      await Promise.all([refetchAgents(), refetchKnowledge()]);
      setWizardOpen(false);
      swalToast(`Setup selesai. ${res.data.knowledge} FAQ disiapkan dan dirapikan.`, 'success');
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Setup belum berhasil';
      swalToast(msg, 'error');
    } finally {
      setWizardLoading(false);
    }
  };

  // ---- QR modal (sambung WhatsApp) ----
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrSeconds, setQrSeconds] = useState(0); // disinkron dari qr_ttl server (durasi asli whatsmeow)
  const [riskAck, setRiskAck] = useState(true); // disclaimer risiko banned, default tercentang
  const [qrError, setQrError] = useState('');
  // Metode sambung: 'qr' (scan) atau 'pairing' (kode 8 huruf, untuk HP yang sama dengan WA).
  const [connectMethod, setConnectMethod] = useState<'qr' | 'pairing'>('qr');
  const [pairPhone, setPairPhone] = useState('');

  // ---- Pilih CS pertama secara otomatis jika belum ada ----

  useEffect(() => {
    if (agents.length && !agents.some(a => a.id === agentId)) {
      setAgentId(agents[0].id);
    }
  }, [agents, agentId]);

  // ---- Isi field persona saat ganti CS ----

  useEffect(() => {
    if (!agentId) return;
    setKnowledgePage(0);
    const a = agents.find(x => x.id === agentId);
    if (a) {
      const settings = settingsFromAgent(a);
      setAgentName(settings.name); setPrompt(settings.system_prompt); setTone(settings.tone);
      setAiEnabled(a.ai_enabled !== false);
      setAutoRead(settings.auto_read);
      setAIReplyDelayMin(settings.ai_reply_delay_min); setAIReplyDelayMax(settings.ai_reply_delay_max);
      setGreetEnabled(settings.greeting_enabled); setGreetMsg(settings.greeting_message);
      setBhEnabled(settings.business_hours_enabled); setBhStart(settings.business_start);
      setBhEnd(settings.business_end); setAwayMsg(settings.away_message);
      setSettingsBaseline(settingsKey(settings));
    }
  }, [agentId, agents]);

  // ---- Simpan tab & CS ke localStorage ----

  useEffect(() => { localStorage.setItem('wai_tab', tab); }, [tab]);
  useEffect(() => { if (agentId) localStorage.setItem('wai_agent', String(agentId)); }, [agentId]);

  // ---- QR: auto-tutup saat tersambung, dan hitung mundur masa berlaku QR ----
  useEffect(() => {
    if (qrModalOpen && status === 'connected') {
      const t = setTimeout(() => setQrModalOpen(false), 1400); // tampilkan sukses sejenak lalu tutup
      return () => clearTimeout(t);
    }
  }, [qrModalOpen, status]);

  useEffect(() => { if (qrTtl > 0) setQrSeconds(qrTtl); }, [qrTtl]); // sinkron dari server tiap polling (durasi asli kode)

  useEffect(() => {
    if (!qrModalOpen || !qr) return;
    const t = setInterval(() => setQrSeconds(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [qrModalOpen, qr]);

  // ---- Handlers ----

  const connect = () => {
    setQrError('');
    setConnectMethod('qr');
    setQrModalOpen(true);
    connectMut.mutateAsync().catch((err: any) => setQrError(err?.response?.data?.error || 'Gagal memulai koneksi. Coba lagi.'));
  };

  const connectPairing = () => {
    setQrError('');
    pairMut.mutateAsync(pairPhone).catch((err: any) => setQrError(err?.response?.data?.error || 'Gagal membuat kode. Coba lagi.'));
  };

  const disconnectWA = async () => {
    if (!await swalConfirm('Putuskan WhatsApp?', 'Perlu scan QR lagi untuk menyambung kembali.')) return;
    try { await disconnectMut.mutateAsync(); } catch { /* refresh status agar UI tetap sinkron */ }
  };

  const saveProfile = async () => {
    if (!profileName.trim()) return;
    setProfileSaving(true);
    try {
      const res = await api.put('/profile', { name: profileName.trim() });
      const updated = res.data.user;
      const stored = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...stored, ...updated }));

      if (profileOldPassword && profileNewPassword) {
        try {
          await api.put('/change-password', { old_password: profileOldPassword, new_password: profileNewPassword });
          swalToast('Profil disimpan');
        } catch (e: any) {
          swalToast(e?.response?.data?.error || 'Gagal ganti password', 'error');
          setProfileSaving(false);
          return;
        }
      } else {
        swalToast('Profil disimpan');
      }
      setProfileModalOpen(false);
      setProfileOldPassword('');
      setProfileNewPassword('');
    } catch {
      swalToast('Gagal menyimpan profil');
    } finally {
      setProfileSaving(false);
    }
  };

  const saveAPIConfigOnly = async () => {
    const apiConfig: Record<string, string> = {};
    if (apiKey && !apiKey.includes('*')) apiConfig.api_key = apiKey;
    if (deepseekKey && !deepseekKey.includes('*')) apiConfig.deepseek_api_key = deepseekKey;
    if (chatProvider) apiConfig.chat_provider = chatProvider;
    if (apiModel) apiConfig.api_model = apiModel;
    if (deepseekModel) apiConfig.deepseek_model = deepseekModel;
    if (visionModel) apiConfig.vision_model = visionModel;
    if (embeddingModel) apiConfig.embedding_model = embeddingModel;
    if (Object.keys(apiConfig).length === 0) {
      swalToast('Tidak ada perubahan untuk disimpan', 'warning');
      return;
    }
    try {
      await api.put('/settings/api-config', apiConfig);
      swalToast('Konfigurasi AI disimpan. Model langsung aktif.', 'success');
      // Refresh daftar model setelah simpan (karena api key mungkin baru)
      if (apiConfig.api_key || apiConfig.deepseek_api_key) void loadChatModels();
      if (apiConfig.api_key) {
        void loadVisionModels();
        void loadEmbeddingModels();
      }
    } catch (e: any) {
      swalToast(e?.response?.data?.error || 'Gagal menyimpan konfigurasi', 'error');
    }
  };

  const loadEmbeddingModels = async () => {
    setEmbeddingModelsLoading(true);
    setEmbeddingModelsError('');
    try {
      const res = await api.get('/settings/embedding-models');
      setEmbeddingModels(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setEmbeddingModelsError(message || 'Daftar model belum dapat dimuat. Simpan API key OpenRouter terlebih dahulu.');
    } finally {
      setEmbeddingModelsLoading(false);
    }
  };

  const loadChatModels = async (provider = chatProvider) => {
    setChatModelsLoading(true);
    setChatModelsError('');
    try {
      const res = await api.get('/settings/chat-models', { params: { provider } });
      setChatModels(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setChatModelsError(message || 'Daftar model chat belum dapat dimuat. Simpan API key terlebih dahulu.');
    } finally {
      setChatModelsLoading(false);
    }
  };

  const loadVisionModels = async () => {
    setVisionModelsLoading(true);
    setVisionModelsError('');
    try {
      const res = await api.get('/settings/vision-models');
      setVisionModels(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setVisionModelsError(message || 'Daftar model vision belum dapat dimuat. Simpan API key OpenRouter terlebih dahulu.');
    } finally {
      setVisionModelsLoading(false);
    }
  };

  const loadAPIConfig = async () => {
    try {
      const res = await api.get('/settings/api-config');
      const cfg = res.data;
      if (cfg.api_key) setApiKey(cfg.api_key);
      if (cfg.deepseek_api_key) setDeepseekKey(cfg.deepseek_api_key);
      if (cfg.chat_provider) setChatProvider(cfg.chat_provider);
      if (cfg.api_model) setApiModel(cfg.api_model);
      if (cfg.deepseek_model) setDeepseekModel(cfg.deepseek_model);
      if (cfg.vision_model) setVisionModel(cfg.vision_model);
      if (cfg.embedding_model) setEmbeddingModel(cfg.embedding_model);
      // Katalog chat ikut provider tersimpan; vision & embedding selalu lewat OpenRouter.
      if (cfg.api_key || cfg.deepseek_api_key) void loadChatModels(cfg.chat_provider || '');
      if (cfg.api_key) {
        void loadVisionModels();
        void loadEmbeddingModels();
      }
    } catch { /* belum ada config */ }
  };

  // Model chat disimpan terpisah per provider: id DeepSeek ("deepseek-chat") dan
  // id OpenRouter ("deepseek/deepseek-chat") tidak saling kompatibel.
  const isDeepSeekDirect = chatProvider === 'deepseek-direct';
  const chatProviderName = isDeepSeekDirect ? 'DeepSeek' : 'OpenRouter';
  const chatModelLabel = `Model chat ${chatProviderName}`;
  const chatModelValue = isDeepSeekDirect ? deepseekModel : apiModel;
  const setChatModelValue = isDeepSeekDirect ? setDeepseekModel : setApiModel;

  // Auto-load config saat membuka tab AI & Model
  useEffect(() => {
    if (tab === 'ai-model' && !chatModels.length && !visionModels.length && !embeddingModels.length) {
      void loadAPIConfig();
    }
  }, [tab]);

  const saveAgent = async () => {
    const e: Record<string, string> = {};
    if (!agentName.trim()) e.agentName = 'Nama CS wajib diisi';
    setSettingsErrors(e);
    if (Object.keys(e).length > 0) return;
    try {
      await saveAgentMut.mutateAsync(currentSettings);
      setSettingsBaseline(settingsKey(currentSettings));
      swalToast('Perubahan pengaturan disimpan');
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || 'Pengaturan belum bisa disimpan';
      swalToast(message, 'error');
    }
  };

  const toggleAI = async (val: boolean) => {
    if (val) {
      const missing: string[] = [];
      if (!prompt.trim()) missing.push('System Prompt / Persona');
      if (!tone) missing.push('Tone / gaya bahasa');
      if (missing.length > 0) {
        setGuardMissing(missing);
        setShowGuardModal(true);
        return;
      }
    }
    setAiEnabled(val);
    try {
      await saveAgentMut.mutateAsync({ ai_enabled: val });
      swalToast(val ? 'Balasan AI diaktifkan' : 'Balasan AI dimatikan', 'success');
    } catch {
      setAiEnabled(!val);
      swalToast('Gagal mengubah status AI', 'error');
    }
  };

  const toggleAutoRead = async (val: boolean) => {
    setAutoRead(val);
    try {
      await saveAgentMut.mutateAsync({ auto_read: val });
      swalToast(val ? 'Pesan akan ditandai dibaca otomatis' : 'Tanda dibaca diatur manual', 'success');
    } catch {
      setAutoRead(!val);
      swalToast('Gagal mengubah pengaturan tanda dibaca', 'error');
    }
  };

  const openAddAgent = () => { setNewAgentName(''); setAddError(''); setAddOpen(true); };

  const submitNewAgent = async () => {
    const name = newAgentName.trim();
    if (!name) { setAddError('Nama Customer Service wajib diisi'); return; }
    try {
      const r = await createAgentMut.mutateAsync({ name, tone: 'ramah' });
      setAgentId(r.data.id);
      setAddOpen(false);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setAddError('Kuota CS penuh, upgrade paket kamu dulu ya');
      } else {
        setAddError(err?.response?.data?.error || 'Gagal menambah CS.');
      }
    }
  };

  const deleteAgent = async () => {
    if (agents.length <= 1) { await swalAlert('Minimal harus ada 1 CS.', 'warning'); return; }
    if (!await swalConfirm('Hapus CS ini?', 'Semua knowledge-nya juga akan terhapus.')) return;
    await deleteAgentMut.mutateAsync(agentId);
    setAgentId(0);
  };

  // deleteAgentById = hapus CS tertentu dari daftar "Kelola CS" (bukan cuma yang aktif).
  const deleteAgentById = async (id: number, name?: string) => {
    if (agents.length <= 1) { await swalAlert('Minimal harus ada 1 CS.', 'warning'); return; }
    if (!await swalConfirm(`Hapus CS "${name || `CS ${id}`}"?`, 'Semua knowledge-nya juga akan terhapus.')) return;
    await deleteAgentMut.mutateAsync(id);
    if (id === agentId) setAgentId(0); // pilihan auto-pindah ke CS lain via efek yang ada
  };

  const addKnowledge = async () => {
    const e: Record<string, string> = {};
    if (!newQ.trim()) e.newQ = 'Pertanyaan wajib diisi';
    if (!newA.trim()) e.newA = 'Jawaban wajib diisi';
    setKnowledgeErrors(e);
    if (Object.keys(e).length > 0) return;
    try {
      const result = await addKnowledgeMut.mutateAsync({ question: newQ, answer: newA, tags: newTags });
      setNewQ(''); setNewA(''); setNewTags(''); setKnowledgeErrors({});
      swalToast(result.merged ? 'FAQ serupa ditemukan dan diperbarui.' : 'FAQ ditambahkan.', 'success');
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'FAQ belum bisa disimpan';
      swalToast(message, 'error');
    }
  };

  const delKnowledge = async (id: number) => {
    if (!await swalConfirm('Hapus Q&A ini?')) return false;
    try {
      await deleteKnowledgeMut.mutateAsync(id);
      swalToast('FAQ dihapus.', 'success');
      return true;
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'FAQ belum bisa dihapus';
      swalToast(message, 'error');
      return false;
    }
  };

  const generateKnowledge = async () => {
    const e: Record<string, string> = {};
    if (!genText.trim()) e.genText = 'Paste teks dulu untuk di-generate';
    setKnowledgeErrors(e);
    if (Object.keys(e).length > 0) return;
    try {
      const res = await generateKnowledgeMut.mutateAsync({ text: genText, count: genCount });
      setGenText('');
      swalToast(`${res.knowledge} FAQ diproses dan duplikat digabung otomatis.`, 'success');
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Informasi belum bisa diubah menjadi FAQ';
      swalToast(message, 'error');
    }
  };

  const resetAIFormDraft = () => {
    setEditingAIForm(null);
    setAIFormName('');
    setAIFormGoal('');
    setAIFormHints('');
    setAIFormSteps(defaultAIFormSteps());
    setAIFormEnabled(true);
    setAIFormHandoff(true);
    setAIFormSuccess('Data *{code}* berhasil dicatat. CS kami akan menindaklanjuti.');
    setAIFormErrors({});
  };

  const editAIForm = (form: AIForm) => {
    setEditingAIForm(form);
    setAIFormName(form.name || '');
    setAIFormGoal(form.goal || '');
    setAIFormHints(parseAIFormJSON<string[]>(form.intent_hints_json, []).join('\n'));
    setAIFormSteps(parseAIFormJSON<AIFormStepConfig[]>(form.steps_json, defaultAIFormSteps()));
    setAIFormEnabled(form.enabled);
    setAIFormHandoff(form.handoff);
    setAIFormSuccess(form.success_message || 'Data *{code}* berhasil dicatat. CS kami akan menindaklanjuti.');
    setAIFormErrors({});
  };

  const updateAIFormStep = (index: number, patch: Partial<AIFormStepConfig>) => {
    setAIFormSteps(prev => prev.map((step, i) => i === index ? { ...step, ...patch } : step));
  };

  const saveAIForm = async () => {
    const e: Record<string, string> = {};
    if (!aiFormName.trim()) e.name = 'Nama form wajib diisi';
    if (!aiFormGoal.trim()) e.goal = 'Tujuan form wajib diisi agar AI paham kapan memulai';
    if (aiFormSteps.some(step => !step.label.trim())) e.steps = 'Pertanyaan tidak boleh kosong';
    if (aiFormSteps.some(step => step.type === 'select' && (step.options || []).filter(Boolean).length < 2)) e.steps = 'Pertanyaan pilihan butuh minimal 2 opsi';
    setAIFormErrors(e);
    if (Object.keys(e).length > 0) return;
    const normalizedSteps = aiFormSteps.map((step, index) => ({
      ...step,
      key: cleanAIFormKey(step.key, `field_${index + 1}`),
      label: step.label.trim(),
      options: step.type === 'select' ? (step.options || []).map(o => o.trim()).filter(Boolean) : undefined,
    }));
    const hints = aiFormHints.split('\n').map(v => v.trim()).filter(Boolean);
    try {
      await saveAIFormMut.mutateAsync({
        id: editingAIForm?.id,
        name: aiFormName.trim(),
        goal: aiFormGoal.trim(),
        intent_hints_json: JSON.stringify(hints),
        steps_json: JSON.stringify(normalizedSteps),
        enabled: aiFormEnabled,
        handoff: aiFormHandoff,
        success_message: aiFormSuccess.trim(),
      });
      resetAIFormDraft();
      swalToast(editingAIForm ? 'Form AI diperbarui.' : 'Form AI ditambahkan.', 'success');
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Form AI belum bisa disimpan';
      swalToast(message, 'error');
    }
  };

  const delAIForm = async (form: AIForm) => {
    if (!await swalConfirm(`Hapus Form AI "${form.name}"?`)) return;
    try {
      await deleteAIFormMut.mutateAsync(form.id);
      if (editingAIForm?.id === form.id) resetAIFormDraft();
      swalToast('Form AI dihapus.', 'success');
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Form AI belum bisa dihapus';
      swalToast(message, 'error');
    }
  };

  const dotColor = (s?: string) => (s === 'connected' ? '#25D366' : s === 'qr' || s === 'connecting' ? '#ffa726' : '#bdbdbd');

  const logout = () => { localStorage.clear(); window.location.href = '/login'; };
  const sc = status === 'connected' ? 'success' : status === 'qr' || status === 'connecting' ? 'warning' : 'error';
  const sl = status === 'connected' ? 'Online' : status === 'connecting' ? 'Menyambung…' : status === 'qr' ? 'Scan QR' : 'Offline';
  const currentAgent = agents.find(a => a.id === agentId);
  // Jumlah CS yang WhatsApp-nya benar-benar tersambung (bukan sekadar jumlah dibuat).
  const connectedCS = agents.filter(a => statusMap[a.id] === 'connected').length;
  const setupIssues = [
    (knowledge.length > 0 || prompt.trim() !== '') ? '' : 'Sebelum mengaktifkan Balasan AI, lengkapi Persona atau Pengetahuan di menu Asisten AI.',
  ].filter(Boolean);

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh', height: { md: '100vh' }, overflow: { md: 'hidden' }, bgcolor: 'background.default' }}>
      <Box
        component="aside"
        sx={{
          width: { xs: '100%', md: 'var(--sidebar-width, 240px)' },
          flexShrink: 0,
          p: { xs: 1.25, md: 1.5 },
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          position: { xs: 'sticky', md: 'static' },
          top: 0,
          zIndex: 10,
          height: { md: '100vh' },
          overflowY: { md: 'auto' },
          bgcolor: 'background.paper',
          borderRight: { md: '1px solid' },
          borderBottom: { xs: '1px solid', md: 0 },
          borderColor: 'divider',
        }}
      >
        <Stack direction={{ xs: 'row', md: 'column' }} spacing={1.25} sx={{ alignItems: { xs: 'center', md: 'stretch' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flexShrink: 0, px: { md: 0.25 } }}>
            <IconButton onClick={() => setSidebarOpen(!sidebarOpen)} sx={{ display: { xs: 'inline-flex', md: 'none' }, flexShrink: 0 }}><MenuIcon /></IconButton>
            <Box
              sx={{
                width: 36, height: 36, borderRadius: 1.5, flexShrink: 0,
                border: '1px solid', borderColor: 'divider',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: 'background.paper', overflow: 'hidden',
              }}
            >
              <img src={logo} alt="SlaluDiskon" style={{ width: 28, height: 28 }} />
            </Box>
            <Box sx={{ minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
              <Typography sx={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2, letterSpacing: '-0.01em' }}>SlaluDiskon</Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: { xs: 'none', md: 'block' }, cursor: 'pointer', fontSize: 11.5, '&:hover': { color: 'primary.main' } }}
                onClick={e => setProfileAnchor(e.currentTarget)}
              >
                {user.name || user.username}
              </Typography>
            </Box>
          </Box>

          <Stack direction="row" spacing={0.5} sx={{ width: { xs: 'auto', md: '100%' }, alignItems: 'center', flexShrink: 0 }}>
            <FormControl size="small" sx={{ width: { xs: 158, md: 'auto' }, flex: { md: 1 } }}>
              <InputLabel>Customer Service</InputLabel>
              <Select value={agents.length ? agentId : ''} label="Customer Service"
                onChange={e => setAgentId(Number(e.target.value))}>
                {agents.map(a => (
                  <MenuItem key={a.id} value={a.id}>
                    <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor(statusMap[a.id]), mr: 1 }} />
                    {a.name || `CS ${a.id}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Kelola CS">
              <IconButton size="small" onClick={() => setManageOpen(true)} sx={{ flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <ManageAccountsOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          <Box sx={{ width: { xs: 'auto', md: '100%' }, flexShrink: 0 }}>
            <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={openAddAgent} disabled={createAgentMut.isPending}>
              Tambah
            </Button>
          </Box>
          <IconButton aria-label="Logout" onClick={logout} color="error" sx={{ display: { xs: 'inline-flex', md: 'none' }, ml: 'auto' }}>
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Divider sx={{ display: { xs: 'none', md: 'block' }, my: 0.25 }} />

        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'row', md: 'column' },
            gap: 0.35,
            overflowX: { xs: 'auto', md: 'visible' },
            pb: { xs: 0.25, md: 0 },
            mx: { xs: -1.25, md: 0 },
            px: { xs: 1.25, md: 0 },
            scrollbarWidth: 'thin',
          }}
        >
          {NAV_GROUPS.map((group, gi) => (
            <Fragment key={group.section || 'main'}>
              {group.section && (
                <Typography
                  variant="caption"
                  sx={{
                    display: { xs: 'none', md: 'block' },
                    px: 1.25, mt: gi === 0 ? 0.25 : 1.25, mb: 0.35,
                    fontWeight: 600, fontSize: '0.65rem', letterSpacing: '0.05em',
                    textTransform: 'uppercase', color: 'text.disabled', lineHeight: 1.5,
                  }}
                >
                  {group.section}
                </Typography>
              )}
              {group.items.map((item) => {
                const active = tab === item.id;
                return (
                  <Button
                    key={item.id}
                    className={active ? 'nav-item nav-item--active' : 'nav-item'}
                    variant="text"
                    startIcon={item.icon}
                    onClick={() => setTab(item.id)}
                    sx={{
                      justifyContent: { xs: 'center', md: 'flex-start' },
                      minWidth: { xs: 'max-content', md: '100%' },
                      height: 36,
                      px: 1.5,
                      borderRadius: 999,
                      fontWeight: active ? 700 : 500,
                      // Aktif: solid primary — lebih tegas dari tint soft
                      color: active ? 'primary.contrastText' : 'text.secondary',
                      bgcolor: active ? 'primary.main' : 'transparent',
                      border: '1px solid',
                      borderColor: active ? 'primary.main' : 'transparent',
                      '&:hover': {
                        bgcolor: active ? 'primary.dark' : 'action.hover',
                        color: active ? 'primary.contrastText' : 'text.primary',
                        borderColor: active ? 'primary.dark' : 'transparent',
                        borderRadius: 999,
                      },
                      '& .MuiButton-startIcon': {
                        mr: 1,
                        color: active ? 'inherit' : 'text.disabled',
                      },
                    }}
                  >
                    {item.id === 'handoff' && handoffs.length > 0 ? (
                      <Badge badgeContent={handoffs.length} color="error" sx={{ mr: 0.5 }}>
                        {item.label}
                      </Badge>
                    ) : (
                      item.label
                    )}
                  </Button>
                );
              })}
            </Fragment>
          ))}
        </Box>
        <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
        <Stack spacing={0.35} sx={{ display: { xs: 'none', md: 'flex' }, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            startIcon={<PersonIcon />}
            onClick={() => setProfileModalOpen(true)}
            sx={{ justifyContent: 'flex-start', color: 'text.secondary', fontWeight: 500, height: 36, px: 1.5, borderRadius: 999 }}
          >
            Profil
          </Button>
          <Button
            startIcon={<LogoutIcon />}
            onClick={logout}
            color="error"
            sx={{ justifyContent: 'flex-start', fontWeight: 500, height: 36, px: 1.5, borderRadius: 999 }}
          >
            Logout
          </Button>
        </Stack>
      </Box>

      <Box
        component="main"
        sx={{
          flex: 1,
          // Inbox butuh full-bleed ala WhatsApp Web (tanpa padding dashboard).
          p: tab === 'inbox' ? 0 : { xs: 1.5, md: 2.5 },
          overflowY: tab === 'inbox' ? 'hidden' : 'auto',
          height: { md: '100vh' },
          minHeight: 0,
          width: '100%',
          minWidth: 0,
          bgcolor: tab === 'inbox' ? '#f0f2f5' : 'background.default',
          display: tab === 'inbox' ? 'flex' : 'block',
          flexDirection: 'column',
        }}
      >
        {tab === 'dashboard' && (
          <Box>
            <PageHeader
              title={<>Dashboard {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400, fontSize: '0.9em' }}>· {currentAgent.name}</Typography>}</>}
              subtitle="Ringkasan status WhatsApp, asisten AI, dan aktivitas utama."
            />

            {/* Hero tautkan WhatsApp: aksi utama saat belum tertaut. Hilang otomatis setelah connect. */}
            {status !== 'connected' && (
              <Card sx={{ mb: 2, borderColor: 'divider', bgcolor: 'background.paper' }}>
                <CardContent>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.75}
                    sx={{ alignItems: 'center', textAlign: { xs: 'center', sm: 'left' } }}>
                    <Box sx={{
                      width: 48, height: 48, borderRadius: 2, bgcolor: 'action.selected', color: 'primary.main',
                      border: '1px solid', borderColor: 'divider',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <QrCodeIcon />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>WhatsApp belum tertaut</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Tautkan WhatsApp untuk mulai mengirim dan menerima pesan secara otomatis.
                      </Typography>
                    </Box>
                    <Button variant="contained" color="primary" size="large" onClick={connect} disabled={connectMut.isPending}
                      startIcon={connectMut.isPending ? <CircularProgress size={18} color="inherit" /> : <QrCodeIcon />}
                      sx={{ flexShrink: 0, fontWeight: 700, px: 3, width: { xs: '100%', sm: 'auto' } }}>
                      {connectMut.isPending ? 'Menyiapkan…' : 'Tautkan WhatsApp'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            )}

            <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
              <Grid size={12}>
                <Card>
                  <CardContent sx={{ pb: '12px !important' }}>
                    {/* Baris atas: status + aksi */}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', mb: 1.5 }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
                        <Chip size="small" label={sl} color={sc} sx={{ fontWeight: 700 }} />
                        <Chip size="small" label={aiEnabled ? 'AI aktif' : 'AI mati'} color={aiEnabled ? 'success' : 'default'} variant={aiEnabled ? 'filled' : 'outlined'} />

                      </Stack>
                      {status === 'connected' && (
                        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                          <Button variant="outlined" size="small" onClick={connect} disabled={connectMut.isPending}
                            startIcon={connectMut.isPending ? <CircularProgress size={14} /> : <QrCodeIcon />}>
                            Reconnect
                          </Button>
                          <Button variant="outlined" size="small" color="error" onClick={disconnectWA} disabled={disconnectMut.isPending}
                            startIcon={disconnectMut.isPending ? <CircularProgress size={14} /> : <LogoutIcon />}>
                            Putuskan
                          </Button>
                        </Stack>
                      )}
                    </Stack>

                    {/* Stat ringkas */}
                    <Grid container spacing={1} sx={{ mb: 1.5 }}>
                      {[
                        { label: 'Status', value: sl, icon: <QrCodeIcon fontSize="small" />, color: dotColor(status) },
                        { label: 'CS terkoneksi', value: `${connectedCS}/${agents.length}`, icon: <SupportAgentIcon fontSize="small" />, color: connectedCS > 0 ? 'success.main' : 'text.secondary' },

                      ].map(item => (
                        <Grid key={item.label} size={{ xs: 6, sm: 6 }}>
                          <Paper variant="outlined" sx={{ p: 1, textAlign: 'center', borderRadius: 1 }}>
                            <Box sx={{ color: item.color, mb: 0.25 }}>{item.icon}</Box>
                            <Typography sx={{ fontWeight: 600, fontSize: 18, lineHeight: 1.2 }}>{item.value}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>{item.label}</Typography>
                          </Paper>
                        </Grid>
                      ))}
                    </Grid>

                    {/* AI toggle + deskripsi */}
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {aiEnabled ? 'AI aktif membalas pelanggan' : 'AI mati - balasan manual oleh Customer Service'}
                        </Typography>
                        {status === 'connected' && waNumber && (
                          <Typography variant="caption" color="text.secondary">
                            +{waNumber}{waName ? ` · ${waName}` : ''}
                          </Typography>
                        )}
                      </Box>
                      <Switch checked={aiEnabled} onChange={e => toggleAI(e.target.checked)} color="success" disabled={!agentId || saveAgentMut.isPending} />
                    </Stack>

                    <Divider sx={{ my: 1.25 }} />

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
                        <Box sx={{ color: autoRead ? 'success.main' : 'text.secondary', display: 'flex', mt: 0.15 }}>
                          <MarkChatReadIcon fontSize="small" />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>Tandai pesan dibaca otomatis</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 680 }}>
                            Jika aktif, pesan langsung dibaca saat masuk. Jika nonaktif, pesan tetap unread sampai dibuka manual atau sampai AI/otomasi benar-benar akan membalasnya.
                          </Typography>
                        </Box>
                      </Stack>
                      <FormControlLabel sx={{ mr: 0, flexShrink: 0 }}
                        control={<Switch checked={autoRead} onChange={event => { void toggleAutoRead(event.target.checked); }} disabled={!agentId || saveAgentMut.isPending} />}
                        label={autoRead ? 'Saat masuk' : 'Saat dibalas'} />
                    </Stack>

                    {setupIssues.length > 0 && (
                      <Alert severity="warning" icon={false} sx={{ mt: 1.5 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}>
                          <Typography variant="body2">{setupIssues[0]}</Typography>
                          <Button size="small" variant="contained" onClick={() => openAgentAI('overview')} sx={{ flexShrink: 0 }}>Buka Asisten AI</Button>
                        </Stack>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

{/* Aksi Cepat: hidden */}
          </Box>
        )}

        {tab === 'agent-ai' && (
          <Box>
            <PageHeader
              title={<>Asisten AI {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>}
              subtitle="Atur cara AI membalas, persona, dan pengetahuan bisnis untuk nomor ini."
            />

            <Card sx={{ mb: 1.5, overflow: 'visible' }}>
              <CardContent>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
                  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box sx={{ position: 'relative', flexShrink: 0 }}>
                      <Avatar className={aiEnabled ? 'ai-agent-avatar ai-agent-avatar--active' : 'ai-agent-avatar'}
                        sx={{ width: 52, height: 52, bgcolor: aiEnabled ? 'rgba(31,138,80,0.12)' : 'action.hover', color: aiEnabled ? 'success.main' : 'text.disabled', border: '1px solid', borderColor: aiEnabled ? 'success.light' : 'divider' }}>
                        <SmartToyIcon />
                      </Avatar>
                      <Box className={aiEnabled ? 'ai-agent-status ai-agent-status--active' : 'ai-agent-status'}
                        sx={{ position: 'absolute', right: 1, bottom: 1, width: 11, height: 11, borderRadius: '50%', bgcolor: aiEnabled ? 'success.main' : 'text.disabled', border: '2px solid', borderColor: 'background.paper' }} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{agentName || 'Asisten AI'}</Typography>
                        <Chip size="small" label={aiEnabled ? 'Aktif' : 'Nonaktif'} color={aiEnabled ? 'success' : 'default'} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {aiEnabled ? 'Siap membalas pelanggan secara otomatis.' : 'Chat masuk tetap tersedia di Inbox untuk dibalas manual.'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>Balasan otomatis</Typography>
                    <Switch checked={aiEnabled} onChange={e => toggleAI(e.target.checked)} color="success" disabled={saveAgentMut.isPending} />
                  </Stack>
                </Stack>

                <ToggleButtonGroup value={agentAIView} exclusive
                  onChange={(_, value: AgentAIView | null) => value && setAgentAIView(value)}
                  size="small" aria-label="Bagian Asisten AI"
                  sx={{ width: '100%', mt: 1.5, '& .MuiToggleButton-root': { flex: 1, gap: 0.75 } }}>
                  <ToggleButton value="overview"><InsightsIcon fontSize="small" sx={{ display: { xs: 'none', sm: 'block' } }} /> Ringkasan</ToggleButton>
                  <ToggleButton value="persona"><PersonIcon fontSize="small" sx={{ display: { xs: 'none', sm: 'block' } }} /> Persona</ToggleButton>
                  <ToggleButton value="knowledge"><KnowledgeIcon fontSize="small" sx={{ display: { xs: 'none', sm: 'block' } }} /> Pengetahuan</ToggleButton>
                  <ToggleButton value="forms"><RuleIcon fontSize="small" sx={{ display: { xs: 'none', sm: 'block' } }} /> Form Layanan</ToggleButton>
                </ToggleButtonGroup>
              </CardContent>
            </Card>
          </Box>
        )}

        {tab === 'agent-ai' && agentAIView === 'overview' && (() => {
          const personaReadyCount = personaChecks.filter(item => item.ready).length;
          const topicReadyCount = knowledgeHealth.topics.filter(item => item.ready).length;
          const taggedPercent = knowledge.length ? Math.round((knowledgeHealth.tagged / knowledge.length) * 100) : 0;
          const items = [
            { label: 'Persona dan batasan', ready: !!prompt.trim(), detail: prompt.trim() ? `${personaReadyCount}/4 elemen penting terdeteksi` : 'Belum diatur', action: () => setAgentAIView('persona') },
            { label: 'Pengetahuan bisnis', ready: knowledge.length > 0, detail: knowledge.length ? `${knowledge.length} FAQ · ${taggedPercent}% bertag · ${topicReadyCount}/5 topik` : 'Belum ada FAQ', action: () => setAgentAIView('knowledge') },
            { label: 'Form Layanan', ready: aiForms.some(form => form.enabled), detail: aiForms.length ? `${aiForms.length} form · ${aiFormSubmissions.length} data masuk` : 'Belum ada alur data', action: () => setAgentAIView('forms') },
            { label: 'Balasan otomatis', ready: aiEnabled, detail: aiEnabled ? 'Aktif' : 'Nonaktif', action: () => undefined },
          ];
          const readyCount = items.filter(i => i.ready).length;
          const allReady = readyCount === items.length;
          return (
            <Box sx={{ maxWidth: 560, mx: 'auto', display: 'grid', gap: 1.5 }}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Kesiapan Asisten</Typography>
                      <Typography variant="caption" color="text.secondary">Lengkapi bagian berikut agar jawaban AI lebih akurat.</Typography>
                    </Box>
                    <Chip size="small" color={allReady ? 'success' : 'default'} label={`${readyCount}/${items.length}`} sx={{ fontWeight: 700 }} />
                  </Stack>

                  <LinearProgress variant="determinate" value={(readyCount / items.length) * 100}
                    color={allReady ? 'success' : 'primary'} sx={{ height: 6, borderRadius: 3, mt: 1.25 }} />

                  <Stack spacing={0.75} sx={{ mt: 1.5 }}>
                    {items.map(item => (
                      <Paper key={item.label} variant="outlined"
                        sx={{ p: 1, transition: 'border-color .2s', borderColor: item.ready ? 'success.light' : undefined }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <CheckCircleIcon fontSize="small" color={item.ready ? 'success' : 'disabled'} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.label}</Typography>
                            <Typography variant="caption" color="text.secondary">{item.detail}</Typography>
                          </Box>
                          {!item.ready && item.label !== 'Balasan otomatis' && <Button size="small" onClick={item.action}>Lengkapi</Button>}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>

                  <Tooltip title={allReady ? '' : 'Lengkapi semua langkah di atas untuk mencoba simulasi.'}>
                    <Box component="span" sx={{ display: 'block', mt: 1.75 }}>
                      <Button fullWidth variant="contained" size="large" startIcon={<ChatIcon />}
                        disabled={!allReady} onClick={() => setTab('coba-chat')}>
                        Coba di Simulasi AI
                      </Button>
                    </Box>
                  </Tooltip>
                  <Typography variant="caption" color={allReady ? 'success.main' : 'text.secondary'}
                    sx={{ display: 'block', textAlign: 'center', mt: 0.75 }}>
                    {allReady ? 'Asisten siap. Uji jawaban AI lewat simulasi percakapan.' : `${items.length - readyCount} langkah lagi untuk membuka simulasi.`}
                  </Typography>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Jeda Balasan AI</Typography>
                  <Typography variant="caption" color="text.secondary">
                    AI akan menampilkan status mengetik sebelum mengirim balasan pertama.
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.25, alignItems: { sm: 'flex-start' } }}>
                    <TextField size="small" type="number" label="Minimal (detik)" value={aiReplyDelayMin}
                      slotProps={{ htmlInput: { min: 0, max: 30 } }}
                      onChange={e => setAIReplyDelayMin(Math.max(0, Math.min(30, Number(e.target.value))))}
                      helperText="Disarankan 4 detik" sx={{ flex: 1 }} />
                    <TextField size="small" type="number" label="Maksimal (detik)" value={aiReplyDelayMax}
                      slotProps={{ htmlInput: { min: aiReplyDelayMin, max: 30 } }}
                      onChange={e => setAIReplyDelayMax(Math.max(aiReplyDelayMin, Math.min(30, Number(e.target.value))))}
                      helperText="Disarankan 8 detik" sx={{ flex: 1 }} />
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">
                      Rentang aktif: {aiReplyDelayMin}–{aiReplyDelayMax} detik
                    </Typography>
                    <Button size="small" variant={hasUnsavedSettings ? 'contained' : 'outlined'} onClick={saveAgent}
                      disabled={settingsBaseline === null || !hasUnsavedSettings || saveAgentMut.isPending}>
                      Simpan Jeda
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Box>
          );
        })()}

        {tab === 'agent-ai' && agentAIView === 'persona' && (
          <Box>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 5 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Identitas dan Gaya Bicara</Typography>
                    <Typography variant="caption" color="text.secondary">Tentukan nama dan cara Asisten AI berbicara kepada pelanggan.</Typography>
                    <Stack spacing={1.25} sx={{ mt: 1.25 }}>
                      <TextField fullWidth size="small" label="Nama Asisten" value={agentName}
                        onChange={e => { setAgentName(e.target.value); if (settingsErrors.agentName) setSettingsErrors(p => ({...p, agentName: ''})); }}
                        error={!!settingsErrors.agentName} helperText={settingsErrors.agentName || 'Nama ini dipakai saat memperkenalkan diri.'} />
                      <FormControl fullWidth size="small">
                        <InputLabel>Gaya bahasa</InputLabel>
                        <Select value={tone} label="Gaya bahasa" onChange={e => setTone(e.target.value)}>
                          {TONES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                        </Select>
                        <FormHelperText>{tone === 'custom' ? 'Mengikuti instruksi persona.' : 'Berlaku pada semua jawaban AI.'}</FormHelperText>
                      </FormControl>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, md: 7 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Persona AI</Typography>
                      <Chip size="small" variant="outlined" color={prompt.trim() ? 'success' : 'warning'} label={prompt.trim() ? 'Sudah diatur' : 'Belum diatur'} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">Jelaskan peran, batasan, dan alur layanan yang harus diikuti AI.</Typography>
                    <TextField multiline minRows={7} fullWidth size="small" label="Instruksi persona" value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="Contoh: Kamu adalah CS toko kami. Bantu pelanggan memilih produk dan jangan mengarang informasi di luar pengetahuan bisnis."
                      helperText={`${prompt.trim().length.toLocaleString()} karakter · Simpan fakta produk, harga, dan kebijakan di Pengetahuan, bukan di persona.`}
                      sx={{ mt: 1.25 }} />
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.5, mt: 1 }}>
                      {personaChecks.map(item => (
                        <Stack key={item.label} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <CheckCircleIcon sx={{ fontSize: 15 }} color={item.ready ? 'success' : 'disabled'} />
                          <Typography variant="caption" color={item.ready ? 'text.primary' : 'text.secondary'}>{item.label}</Typography>
                        </Stack>
                      ))}
                    </Box>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.75, alignItems: { xs: 'stretch', sm: 'center' } }}>
                      <Button size="small" variant="outlined" onClick={applySafePersonaTemplate}>Pakai kerangka aman</Button>
                      <Button size="small" variant="text" onClick={() => { setExampleMode('prompt'); setExampleModalOpen(true); }}>Lihat contoh persona</Button>
                      {trainedCount > 0 && (
                        <Button size="small" variant="outlined" disabled={regenPersonaMut.isPending || isTraining}
                          onClick={regeneratePersona} startIcon={regenPersonaMut.isPending ? <CircularProgress size={14} /> : <LanguageIcon />}>
                          {prompt.trim() ? 'Perbarui dari website' : 'Buat dari website'}
                        </Button>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
            <Paper variant="outlined" sx={{ mt: 1.5, p: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
                <Typography variant="caption" color={hasUnsavedSettings ? 'warning.main' : 'text.secondary'} sx={{ fontWeight: 700 }}>
                  {settingsBaseline === null ? 'Memuat pengaturan...' : hasUnsavedSettings ? 'Ada perubahan yang belum disimpan' : 'Persona sudah tersimpan'}
                </Typography>
                <Button variant={hasUnsavedSettings ? 'contained' : 'outlined'} onClick={saveAgent}
                  disabled={settingsBaseline === null || !hasUnsavedSettings || saveAgentMut.isPending}
                  startIcon={saveAgentMut.isPending ? <CircularProgress size={15} color="inherit" /> : undefined}>
                  Simpan Persona
                </Button>
              </Stack>
            </Paper>
          </Box>
        )}

        {tab === 'agent-ai' && agentAIView === 'forms' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)' }, gap: 1.5, alignItems: 'start' }}>
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { xs: 'stretch', sm: 'flex-start' }, justifyContent: 'space-between', mb: 1.25 }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{editingAIForm ? 'Edit Form Layanan' : 'Buat Form Layanan'}</Typography>
                  <Typography variant="caption" color="text.secondary">Khusus booking, konsultasi, pendaftaran, survei, atau kebutuhan non-produk. Produk memakai checkout dari menu Produk.</Typography>
                </Box>
                {editingAIForm && <Button size="small" variant="outlined" onClick={resetAIFormDraft}>Batal edit</Button>}
              </Stack>
              <Stack spacing={1.25}>
                <TextField size="small" fullWidth label="Nama form" placeholder="Booking konsultasi" value={aiFormName}
                  onChange={e => { setAIFormName(e.target.value); if (aiFormErrors.name) setAIFormErrors(p => ({ ...p, name: '' })); }}
                  error={!!aiFormErrors.name} helperText={aiFormErrors.name || 'Nama ini terlihat di ringkasan dan chat pelanggan.'} />
                <TextField size="small" fullWidth multiline rows={2} label="Tujuan form" placeholder="Mengumpulkan data calon customer yang ingin konsultasi bisnis."
                  value={aiFormGoal}
                  onChange={e => { setAIFormGoal(e.target.value); if (aiFormErrors.goal) setAIFormErrors(p => ({ ...p, goal: '' })); }}
                  error={!!aiFormErrors.goal} helperText={aiFormErrors.goal || 'AI memakai tujuan ini untuk memahami kapan form perlu dimulai.'} />
                <TextField size="small" fullWidth multiline rows={3} label="Contoh kalimat pelanggan (opsional)"
                  placeholder={'Saya mau konsultasi\nBisa booking besok?\nMau daftar layanan'}
                  value={aiFormHints}
                  onChange={e => setAIFormHints(e.target.value)}
                  helperText="Satu contoh per baris. Ini bukan keyword wajib, hanya membantu AI lebih akurat memilih form." />

                <Box>
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Pertanyaan</Typography>
                    <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setAIFormSteps(prev => [...prev, { key: `field_${prev.length + 1}`, label: 'Pertanyaan baru', type: 'text', required: true }])}>Tambah</Button>
                  </Stack>
                  <Stack spacing={1}>
                    {aiFormSteps.map((step, index) => (
                      <Box key={`${step.key}-${index}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                        <Grid container spacing={1}>
                          <Grid size={{ xs: 12, md: 5 }}>
                            <TextField size="small" fullWidth label={`Pertanyaan ${index + 1}`} value={step.label}
                              onChange={e => updateAIFormStep(index, { label: e.target.value })} />
                          </Grid>
                          <Grid size={{ xs: 6, md: 2 }}>
                            <TextField size="small" select fullWidth label="Tipe" value={step.type}
                              onChange={e => updateAIFormStep(index, { type: e.target.value as AIFormStepType, options: e.target.value === 'select' ? (step.options?.length ? step.options : ['Pilihan 1', 'Pilihan 2']) : undefined })}>
                              <MenuItem value="text">Teks</MenuItem>
                              <MenuItem value="number">Angka</MenuItem>
                              <MenuItem value="select">Pilihan</MenuItem>
                            </TextField>
                          </Grid>
                          <Grid size={{ xs: 6, md: 2 }}>
                            <TextField size="small" fullWidth label="Kode" value={step.key}
                              onChange={e => updateAIFormStep(index, { key: e.target.value })} />
                          </Grid>
                          <Grid size={{ xs: 12, md: 3 }}>
                            <Stack direction="row" sx={{ justifyContent: 'flex-end', alignItems: 'center', gap: 0.5 }}>
                              <FormControlLabel control={<Switch size="small" checked={step.required} onChange={e => updateAIFormStep(index, { required: e.target.checked })} />} label="Wajib" />
                              <IconButton size="small" color="error" disabled={aiFormSteps.length <= 1} onClick={() => setAIFormSteps(prev => prev.filter((_, i) => i !== index))}><DeleteIcon fontSize="small" /></IconButton>
                            </Stack>
                          </Grid>
                          {step.type === 'select' && (
                            <Grid size={{ xs: 12 }}>
                              <TextField size="small" fullWidth label="Opsi pilihan" value={(step.options || []).join(', ')}
                                onChange={e => updateAIFormStep(index, { options: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })}
                                placeholder="Ya, Tidak, Mungkin" />
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    ))}
                  </Stack>
                  {aiFormErrors.steps && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{aiFormErrors.steps}</Typography>}
                </Box>

                <Divider />
                <FormControlLabel control={<Switch checked={aiFormEnabled} onChange={e => setAIFormEnabled(e.target.checked)} />} label="Form aktif" />
                <FormControlLabel control={<Switch checked={aiFormHandoff} onChange={e => setAIFormHandoff(e.target.checked)} />} label="Setelah konfirmasi, masukkan ke Butuh CS" />
                <TextField size="small" fullWidth multiline rows={2} label="Pesan setelah konfirmasi" value={aiFormSuccess}
                  onChange={e => setAIFormSuccess(e.target.value)}
                  helperText="Gunakan {code} untuk kode data dan {form} untuk nama form. Jika {code} tidak ditulis, sistem tetap menambahkannya otomatis." />
                <Alert severity="info">
                  <b>Pencatatan natural:</b> AI menjawab dan mengklarifikasi terlebih dahulu. Form baru ditampilkan saat pelanggan benar-benar ingin melanjutkan. Data dianggap masuk setelah dikonfirmasi dan menerima kode FORM; permintaan perubahan akan membuka data lama tanpa membuat duplikat.
                </Alert>
                <Button variant="contained" onClick={saveAIForm} disabled={saveAIFormMut.isPending}>
                  {saveAIFormMut.isPending ? 'Menyimpan...' : editingAIForm ? 'Simpan perubahan' : 'Simpan Form Layanan'}
                </Button>
              </Stack>
            </Paper>

            <Stack spacing={1.25}>
              <Paper variant="outlined" sx={{ p: 1.25 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Daftar Form Layanan</Typography>
                    <Typography variant="caption" color="text.secondary">AI mengingat data pelanggan, membedakan pertanyaan dengan niat memproses, lalu membuka form baru atau mode edit sesuai konteks.</Typography>
                  </Box>
                  <Chip size="small" label={`${aiForms.length} form`} />
                </Stack>
                <Stack spacing={0.75}>
                  {aiForms.length === 0 && <Alert severity="info" icon={false}>Belum ada Form Layanan. Buat satu untuk booking, daftar, atau konsultasi non-produk.</Alert>}
                  {aiForms.map(form => (
                    <Box key={form.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{form.name}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{form.goal || 'Tanpa tujuan'}</Typography>
                        </Box>
                        <Chip size="small" color={form.enabled ? 'success' : 'default'} label={form.enabled ? 'Aktif' : 'Nonaktif'} />
                      </Stack>
                      <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                        <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => editAIForm(form)}>Edit</Button>
                        <Button size="small" color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => void delAIForm(form)}>Hapus</Button>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.25 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Data terbaru</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Hasil form yang sudah dikonfirmasi pelanggan.</Typography>
                <Stack spacing={0.75}>
                  {aiFormSubmissions.length === 0 && <Typography variant="caption" color="text.secondary">Belum ada data masuk.</Typography>}
                  {aiFormSubmissions.slice(0, 5).map(row => (
                    <Box key={row.id} sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.code}</Typography>
                        <Chip size="small" color="success" label="Tersimpan" />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">{row.form?.name || 'Form AI'} · {row.sender}</Typography>
                      <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', mt: 0.5, m: 0, color: 'text.secondary' }}>{row.summary}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Paper>
            </Stack>
          </Box>
        )}

        {tab === 'agent-ai' && agentAIView === 'knowledge' && (
          <Box>
            <Paper variant="outlined" sx={{ p: 1.25, mb: 1.25 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { xs: 'stretch', sm: 'flex-start' }, justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Kualitas pengetahuan</Typography>
                  <Typography variant="caption" color="text.secondary">Periksa kelengkapan dasar sebelum mengaktifkan jawaban otomatis.</Typography>
                </Box>
                <Chip size="small" color={knowledge.length ? 'success' : 'default'} label={`${knowledge.length} FAQ tersimpan`} />
              </Stack>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 0.75, mt: 1 }}>
                {[
                  { label: 'Memiliki tag', value: `${knowledgeHealth.tagged}/${knowledge.length}` },
                  { label: 'Jawaban jelas', value: `${knowledgeHealth.detailed}/${knowledge.length}` },
                  { label: 'Pencarian AI', value: kbUsage?.semantic_search ? `Semantik ${kbUsage.embedded_knowledge || 0}/${knowledge.length}` : 'Kata kunci' },
                  { label: 'Cakupan topik', value: `${knowledgeHealth.topics.filter(item => item.ready).length}/5` },
                ].map(item => (
                  <Box key={item.label} sx={{ px: 1, py: 0.75, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography sx={{ fontWeight: 600, lineHeight: 1.1 }}>{item.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                  </Box>
                ))}
              </Box>
              <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                {knowledgeHealth.topics.map(topic => (
                  <Chip key={topic.label} size="small" variant="outlined" color={topic.ready ? 'success' : 'default'}
                    label={`${topic.ready ? '✓' : '○'} ${topic.label}`} />
                ))}
              </Stack>
              {knowledgeHealth.suggestions.slice(0, 2).map((suggestion, index) => (
                <Typography key={suggestion} variant="caption" color="warning.dark" sx={{ display: 'block', mt: index === 0 ? 0.75 : 0.15 }}>
                  {index === 0 ? 'Saran: ' : '· '}{suggestion}
                </Typography>
              ))}
              {knowledge.length > 0 && kbUsage && !kbUsage.semantic_search && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Pencarian semantik belum aktif; AI tetap memakai pencocokan kata dan tag. Isi konfigurasi embedding untuk hasil parafrase yang lebih kuat.
                </Typography>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25, mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.25 }}>Pilih sumber pengetahuan AI</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Informasi dari sumber ini akan dipakai AI untuk menjawab pelanggan. Kamu tidak perlu mengisi semuanya sekaligus.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 0.75 }}>
                {[
                  { value: 'wizard' as const, label: 'Setup Cepat', icon: <AutoAwesomeIcon fontSize="small" /> },
                  { value: 'web' as const, label: 'Website', icon: <LanguageIcon fontSize="small" /> },
                  { value: 'text' as const, label: 'Tulis Info', icon: <AutoAwesomeIcon fontSize="small" /> },
                  { value: 'manual' as const, label: 'FAQ Manual', icon: <AddIcon fontSize="small" /> },
                ].map(item => (
                  <ToggleButton key={item.value} value={item.value} selected={knowledgeSource === item.value}
                    onClick={() => setKnowledgeSource(item.value)} size="small"
                    sx={{ border: '1px solid !important', borderColor: knowledgeSource === item.value ? 'primary.main !important' : 'divider !important', borderRadius: '6px !important', gap: 0.5, textTransform: 'none' }}>
                    {item.icon}{item.label}
                  </ToggleButton>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                {knowledgeSource === 'wizard' && 'Cara tercepat: isi profil bisnis, AI otomatis membuat persona dan FAQ awal.'}
                {knowledgeSource === 'web' && 'Cocok jika informasi produk dan bisnis sudah lengkap di website.'}
                {knowledgeSource === 'text' && 'Cocok jika kamu punya deskripsi bisnis yang ingin diubah AI menjadi beberapa FAQ.'}
                {knowledgeSource === 'manual' && 'Cocok untuk menambahkan satu pertanyaan dan jawaban yang harus presisi.'}
              </Typography>
            </Paper>

            {/* Setup Cepat (wizard) */}
            {knowledgeSource === 'wizard' && <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 0.25 }}>✨ Setup Cepat</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Cukup isi profil bisnismu (nama, produk, harga, cara order, dll). Sistem otomatis membuat persona AI dan beberapa FAQ awal—cara paling cepat menyiapkan asisten tanpa menulis manual.
                </Typography>
                {knowledge.length > 0 && (
                  <Alert severity="info" sx={{ mb: 1, py: 0.25, '& .MuiAlert-message': { py: 0.5 } }}>
                    <Typography variant="caption">Setup Cepat hanya mengganti hasil Setup Cepat sebelumnya. FAQ dari sumber lain tetap aman.</Typography>
                  </Alert>
                )}
                <Button variant="contained" color="success" startIcon={<AutoAwesomeIcon />} onClick={() => setWizardOpen(true)}>
                  Mulai Setup Cepat
                </Button>
              </CardContent>
            </Card>}

            {/* Latih dari Website */}
            {knowledgeSource === 'web' && <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 0.25 }}>🌐 Latih dari Website</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Masukkan alamat website bisnis, lalu pilih halaman yang berisi informasi pelanggan. Sistem mengubahnya menjadi FAQ dan menggabungkan informasi yang serupa secara otomatis. Persona tidak akan berubah.
                </Typography>

                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  <TextField size="small" fullWidth placeholder="https://websitebisnismu.com" value={crawlUrl}
                    onChange={e => setCrawlUrl(e.target.value)}
                    disabled={crawlJob?.status === 'crawling' || crawlJob?.status === 'pending'} />
                  <Button variant="contained" size="small" onClick={startCrawl}
                    disabled={startCrawlMut.isPending || crawlJob?.status === 'crawling' || crawlJob?.status === 'pending'}
                    startIcon={(crawlJob?.status === 'crawling' || crawlJob?.status === 'pending') ? <CircularProgress size={14} /> : undefined}>
                    {(crawlJob?.status === 'crawling' || crawlJob?.status === 'pending') ? 'Menelusuri…' : 'Mulai'}
                  </Button>
                </Stack>

                {kbUsage && (
                  <Box sx={{ mb: 1 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="caption" color="text.secondary">Pemakaian knowledge</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {kbUsage.max_chars > 0
                          ? `${kbUsage.used_chars.toLocaleString()} / ${kbUsage.max_chars.toLocaleString()} karakter · maks ${kbUsage.max_pages} halaman/crawl`
                          : `${kbUsage.used_chars.toLocaleString()} karakter tersimpan · tanpa batas`}
                      </Typography>
                    </Stack>
                    {kbUsage.max_chars > 0 && <LinearProgress variant="determinate"
                      value={Math.min(100, (kbUsage.used_chars / kbUsage.max_chars) * 100)}
                      sx={{ height: 6, borderRadius: 3, mt: 0.25 }} />}
                  </Box>
                )}

                {crawlJob && (
                  <>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75, flexWrap: 'wrap' }}>
                      <Chip size="small"
                        label={crawlJob.status === 'crawling' || crawlJob.status === 'pending' ? 'Menelusuri…'
                          : crawlJob.status === 'training' ? 'Melatih AI…'
                          : crawlJob.status === 'stopping' ? 'Menghentikan…'
                          : crawlJob.status === 'failed' ? 'Gagal' : `Selesai · ${crawlJob.pages_found} halaman`}
                        color={crawlJob.status === 'failed' ? 'error' : crawlJob.status === 'done' ? 'success' : 'default'} />
                      {crawlJob.domain && <Typography variant="caption" color="text.secondary">{crawlJob.domain}</Typography>}
                      {crawlJob.error && <Typography variant="caption" color="error">{crawlJob.error}</Typography>}
                      {crawlJob.persona_updated && <Chip size="small" color="success" variant="outlined" label="Persona diperbarui" />}
                    </Stack>
                    {crawlJob.persona_error && <Alert severity="warning" sx={{ mb: 1, py: 0.25, '& .MuiAlert-message': { py: 0.5 } }}>
                      <Typography variant="caption">FAQ sudah tersimpan, tetapi persona belum diperbarui: {crawlJob.persona_error}</Typography>
                    </Alert>}

                    {isTraining && (
                      <Box sx={{ mb: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.25, justifyContent: 'space-between' }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                            <CircularProgress size={14} />
                            <Typography variant="caption" color="text.secondary">
                              {crawlJob.status === 'stopping'
                                ? 'Menghentikan pelatihan…'
                                : `AI sedang merangkum halaman jadi FAQ (${trainedCount}/${crawlPages.length} halaman)…`}
                            </Typography>
                          </Stack>
                          <Button size="small" color="error" variant="outlined" sx={{ flexShrink: 0 }}
                            disabled={stopTrainMut.isPending || crawlJob.status === 'stopping'}
                            onClick={stopTraining}>
                            {crawlJob.status === 'stopping' ? 'Menghentikan…' : 'Stop'}
                          </Button>
                        </Stack>
                        <LinearProgress variant="determinate"
                          value={crawlPages.length ? (trainedCount / crawlPages.length) * 100 : 0}
                          sx={{ height: 6, borderRadius: 3 }} />
                      </Box>
                    )}

                    {trainingDone && (
                      <Alert severity={trainedCount > 0 ? 'success' : 'warning'} sx={{ mb: 1, py: 0.25, '& .MuiAlert-message': { py: 0.5 } }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                          Pelatihan selesai
                        </Typography>
                        <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.5 }}>
                          ✅ {trainedCount} halaman dilatih
                          {skippedCount > 0 && ` · ⏭️ ${skippedCount} dilewati (tak ada info berguna)`}
                          {failedTrainCount > 0 && ` · ⚠️ ${failedTrainCount} gagal`}
                          {trainedCount > 0 && '. FAQ-nya tersimpan di daftar Knowledge di bawah ⬇️'}
                          {crawlJob.persona_updated && ' Persona diperbarui otomatis dari halaman yang berhasil dilatih.'}
                        </Typography>
                      </Alert>
                    )}

                    {crawlPages.length > 0 && (
                      <>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          Halaman diurutkan skor AI-training (multi-sinyal: topik CS, harga, kontak, URL, kekayaan teks).
                          <b> Rekomendasi</b> auto-centang; sesuaikan lalu klik Latih.
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
                          <Button size="small" disabled={isTraining} onClick={() => {
                            const trainable = crawlPages.filter(p => (p.status === 'crawled' || p.status === 'failed') && p.char_count > 0).map(p => p.id);
                            setSelectedPages(selectedPages.length === trainable.length ? [] : trainable);
                          }}>{selectedPages.length > 0 ? 'Batal pilih' : 'Pilih semua'}</Button>
                          <Button size="small" disabled={isTraining} onClick={() => {
                            setSelectedPages(
                              [...crawlPages]
                                .filter(p => p.recommended && p.status === 'crawled')
                                .sort((a, b) => (b.recommend_score ?? 0) - (a.recommend_score ?? 0))
                                .map(p => p.id),
                            );
                          }}>Pilih rekomendasi</Button>
                          {failedTrainCount > 0 && <Button size="small" disabled={isTraining} onClick={() => {
                            setSelectedPages(crawlPages.filter(p => p.status === 'failed' && p.char_count > 0).map(p => p.id));
                          }}>Coba ulang gagal</Button>}
                          <Button size="small" variant="contained" disabled={selectedPages.length === 0 || trainCrawlMut.isPending || isTraining}
                            onClick={trainSelected}
                            startIcon={trainCrawlMut.isPending ? <CircularProgress size={14} /> : <AddIcon />}>
                            Latih {selectedPages.length > 0 ? `(${selectedPages.length})` : ''}
                          </Button>
                        </Stack>
                        <Paper variant="outlined" sx={{ maxHeight: 280, overflow: 'auto' }}>
                          {crawlPages.map((p, i) => {
                            const trainable = (p.status === 'crawled' || p.status === 'failed') && p.char_count > 0;
                            const thin = trainable && !p.recommended;
                            const score = p.recommend_score ?? 0;
                            const tier = p.recommend_tier || '';
                            const rowBg =
                              p.status === 'trained' ? 'rgba(46,125,50,0.12)'
                              : p.status === 'training' ? 'rgba(2,136,209,0.12)'
                              : p.status === 'skipped' ? 'rgba(0,0,0,0.05)'
                              : p.status === 'failed' ? 'rgba(211,47,47,0.10)'
                              : p.recommended ? 'rgba(22,138,74,0.06)'
                              : 'transparent';
                            return (
                              <Box key={p.id} sx={{ display: 'flex', gap: 0.5, px: 1, py: 0.5, borderBottom: i < crawlPages.length - 1 ? '1px solid' : 0, borderColor: 'divider', alignItems: 'flex-start', opacity: thin ? 0.75 : 1, bgcolor: rowBg }}>
                                <Checkbox size="small" sx={{ p: 0.25, mt: 0.25 }} disabled={!trainable || isTraining}
                                  checked={selectedPages.includes(p.id)}
                                  onChange={e => setSelectedPages(s => e.target.checked ? [...s, p.id] : s.filter(x => x !== p.id))} />
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                  <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.3, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || p.url}</Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url}</Typography>
                                  {p.recommend_reason && p.status === 'crawled' && (
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.25, mt: 0.15 }}>
                                      {p.recommend_reason}
                                    </Typography>
                                  )}
                                  {p.error && <Typography variant="caption" color="error" sx={{ display: 'block', lineHeight: 1.2 }}>{p.error}</Typography>}
                                </Box>
                                {trainable && score > 0 && (
                                  <Chip
                                    size="small"
                                    label={`${score}`}
                                    color={score >= 65 ? 'success' : score >= 42 ? 'primary' : 'default'}
                                    title={p.recommend_reason || `Skor ${score}`}
                                    sx={{ fontSize: '0.6rem', height: 18, flexShrink: 0, fontWeight: 700, minWidth: 32 }}
                                  />
                                )}
                                {p.recommended && p.status === 'crawled' && (
                                  <Chip size="small" label={tier === 'strong' ? 'Top' : 'Rekomendasi'} color="primary"
                                    sx={{ fontSize: '0.6rem', height: 18, flexShrink: 0 }} />
                                )}
                                {thin && (
                                  <Chip size="small" variant="outlined" label={score > 0 ? 'Opsional' : 'Konten tipis'}
                                    sx={{ fontSize: '0.6rem', height: 18, flexShrink: 0 }} />
                                )}
                                <Chip size="small" variant="outlined"
                                  label={
                                    p.status === 'trained' ? 'Dilatih ✓'
                                    : p.status === 'training' ? 'Melatih…'
                                    : p.status === 'skipped' ? 'Dilewati'
                                    : p.status === 'failed' ? 'Gagal'
                                    : `${p.char_count.toLocaleString()} krkt`}
                                  color={p.status === 'trained' ? 'success' : p.status === 'failed' ? 'error' : 'default'}
                                  sx={{ fontSize: '0.6rem', height: 18, flexShrink: 0 }} />
                              </Box>
                            );
                          })}
                        </Paper>
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>}

            {knowledgeSource === 'text' && (
              <Card sx={{ mb: 1.5 }}>
                <CardContent>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Ubah deskripsi menjadi FAQ</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                      Tempel informasi produk atau layanan. AI akan merangkumnya menjadi beberapa pertanyaan dan jawaban.
                    </Typography>

                    <TextField multiline rows={5} fullWidth size="small" label="Informasi sumber" value={genText}
                      onChange={e => setGenText(e.target.value)}
                      placeholder={'Contoh:\nProduk: Kaos polos cotton combed 24s\nHarga: Rp75.000\nUkuran: S-XXL\nCara order: pilih warna dan ukuran, lalu kirim alamat\nPengiriman: JNE/J&T setiap Senin-Sabtu'}
                      helperText="Tulis fakta sejelas mungkin. AI hanya akan menyusun ulang informasi yang tersedia, bukan melengkapinya dengan asumsi."
                      sx={{ mb: 1 }} />

                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField type="number" size="small" label="Jumlah FAQ" value={genCount}
                        slotProps={{ htmlInput: { min: 1, max: 30 } }}
                        onChange={e => setGenCount(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} sx={{ width: 100 }} />
                      <Button variant="contained" size="small" onClick={generateKnowledge} disabled={generateKnowledgeMut.isPending}
                        startIcon={generateKnowledgeMut.isPending ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}>
                        Generate
                      </Button>
                    </Stack>
                </CardContent>
              </Card>
            )}

            {knowledgeSource === 'manual' && (
              <Card sx={{ mb: 1.5 }}>
                <CardContent>
                    <Typography variant="subtitle2" sx={{ mb: 0.25 }}>Tambah satu FAQ</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                      Gunakan cara ini untuk informasi yang jawabannya harus ditulis secara presisi.
                    </Typography>
                    <Stack spacing={0.75}>
                      <TextField size="small" label="Pertanyaan" value={newQ}
                        onChange={e => { setNewQ(e.target.value); if (knowledgeErrors.newQ) setKnowledgeErrors(p => ({...p, newQ: ''})); }}
                        placeholder="Contoh: Berapa harga kaos polos ukuran XL?"
                        error={!!knowledgeErrors.newQ} helperText={knowledgeErrors.newQ || 'Tulis seperti cara pelanggan bertanya.'} />
                      <TextField size="small" label="Jawaban" multiline rows={2} value={newA}
                        onChange={e => { setNewA(e.target.value); if (knowledgeErrors.newA) setKnowledgeErrors(p => ({...p, newA: ''})); }}
                        error={!!knowledgeErrors.newA} helperText={knowledgeErrors.newA || 'Jawab lengkap dan faktual agar tetap jelas saat dibaca tanpa konteks lain.'} />
                      <TextField size="small" label="Kata pencarian" value={newTags} onChange={e => setNewTags(e.target.value)}
                        placeholder="harga, kaos, ukuran" helperText="Pisahkan dengan koma. Gunakan istilah yang mungkin diketik pelanggan." />
                      <Button size="small" startIcon={<AddIcon />} variant="contained" onClick={addKnowledge} disabled={addKnowledgeMut.isPending}>Tambah</Button>
                    </Stack>
                </CardContent>
              </Card>
            )}

            {(() => {
              const totalPages = Math.ceil(filteredKnowledge.length / KNOWLEDGE_PER_PAGE);
              const safePage = Math.min(knowledgePage, Math.max(0, totalPages - 1));
              const start = safePage * KNOWLEDGE_PER_PAGE;
              const pageItems = filteredKnowledge.slice(start, start + KNOWLEDGE_PER_PAGE);
              return (
                <>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Pengetahuan AI</Typography>
                      <Typography variant="caption" color="text.secondary">Satu daftar bersih dari semua sumber. Edit atau hapus langsung informasi yang sudah tidak berlaku.</Typography>
                    </Box>
                    {knowledge.length > 0 && (
                      <Button size="small" color="error" variant="outlined" onClick={async () => {
                        if (!await swalConfirm('Hapus semua knowledge?', 'Semua Q&A akan dihapus permanen.')) return;
                        try { await deleteAllKnowledgeMut.mutateAsync(); swalToast('Semua knowledge dihapus', 'success'); } catch { swalToast('Gagal', 'error'); }
                      }} disabled={deleteAllKnowledgeMut.isPending}>
                        {deleteAllKnowledgeMut.isPending ? '…' : 'Hapus Semua'}
                      </Button>
                    )}
                  </Stack>
                  {knowledge.length > 0 && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ mb: 0.75 }}>
                      <TextField size="small" fullWidth placeholder="Cari pertanyaan, jawaban, atau tag"
                        value={knowledgeQuery} onChange={e => { setKnowledgeQuery(e.target.value); setKnowledgePage(0); }} />
                      <TextField select size="small" label="Sumber utama" value={knowledgeListSource}
                        onChange={e => { setKnowledgeListSource(e.target.value); setKnowledgePage(0); }} sx={{ minWidth: { sm: 160 } }}>
                        <MenuItem value="">Semua sumber</MenuItem>
                        {knowledgeSources.map(source => <MenuItem key={source} value={source}>{KNOWLEDGE_SOURCE_LABELS[source] || source}</MenuItem>)}
                      </TextField>
                    </Stack>
                  )}
                  {knowledge.length === 0 ? (
                    <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderStyle: 'dashed', bgcolor: 'action.hover' }}>
                      <KnowledgeIcon sx={{ fontSize: 36, color: 'text.disabled', mb: 0.75 }} />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>Belum ada FAQ</Typography>
                      <Typography variant="caption" color="text.secondary">Gunakan pilihan di atas untuk menambahkan knowledge pertama.</Typography>
                    </Paper>
                  ) : filteredKnowledge.length === 0 ? (
                    <Paper variant="outlined" sx={{ p: 2.5, textAlign: 'center', borderStyle: 'dashed' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>FAQ tidak ditemukan</Typography>
                      <Typography variant="caption" color="text.secondary">Ubah kata pencarian atau filter sumber.</Typography>
                    </Paper>
                  ) : (
                    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                    {pageItems.map((k, i) => (
                      <Box key={k.id} sx={{ display: 'flex', gap: 0.75, px: 1.5, py: 1, borderBottom: i < pageItems.length - 1 ? '1px solid' : 0, borderColor: 'divider', alignItems: 'flex-start' }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main', flexShrink: 0, minWidth: 28, lineHeight: 1.5 }}>Q{k.id}:</Typography>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.5, fontWeight: 600 }}>{k.question}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4 }}>A: {k.answer}</Typography>
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.25, flexWrap: 'wrap' }}>
                            <Chip label={KNOWLEDGE_SOURCE_LABELS[k.source || 'manual'] || k.source || 'Manual'} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />
                            {k.tags && <Chip label={k.tags} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                            {(!k.tags?.trim() || k.answer.trim().length < 25) && <Chip label="Perlu dilengkapi" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
                          </Stack>
                        </Box>
                        <Tooltip title="Edit FAQ"><IconButton onClick={() => {
                          setEditingKnowledge(k);
                          setEditingKnowledgeDraft({ question: k.question, answer: k.answer, tags: k.tags || '' });
                        }} size="small" sx={{ flexShrink: 0, mt: -0.25 }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <IconButton onClick={async () => { if (await delKnowledge(k.id) && pageItems.length === 1 && safePage > 0) setKnowledgePage(safePage - 1); }} size="small" color="error" sx={{ flexShrink: 0, mt: -0.25 }}><DeleteIcon fontSize="small" /></IconButton>
                      </Box>
                    ))}
                    </Paper>
                  )}
                  {totalPages > 1 && (
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', alignItems: 'center', mt: 1 }}>
                      <Button size="small" variant="outlined" disabled={safePage === 0}
                        onClick={() => setKnowledgePage(p => Math.max(0, p - 1))}>
                        ← Sebelumnya
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        {safePage + 1} / {totalPages}
                      </Typography>
                      <Button size="small" variant="outlined" disabled={safePage >= totalPages - 1}
                        onClick={() => setKnowledgePage(p => Math.min(totalPages - 1, p + 1))}>
                        Berikutnya →
                      </Button>
                    </Stack>
                  )}
                </>
              );
            })()}
          </Box>
        )}

        {tab === 'ai-model' && (
          <Box>
            <PageHeader
              title={<><AutoAwesomeIcon sx={{ mr: 1, verticalAlign: 'middle' }} />AI & Model</>}
              subtitle="Atur API key OpenRouter serta model untuk chat, pemahaman gambar, dan embedding knowledge."
            />

            <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>OpenRouter · satu pintu AI</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Satu API key dipakai untuk chat AI, vision gambar, pembuatan persona, pemilihan Form Layanan, dan embedding knowledge. Buat key di{' '}
                  <Link href="https://openrouter.ai" target="_blank" rel="noopener">openrouter.ai</Link>.
                </Typography>

                <TextField
                  label="API Key OpenRouter"
                  size="small"
                  type="password"
                  fullWidth
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-or-..."
                  helperText={apiKey.includes('*') ? 'API key sudah tersimpan. Biarkan apa adanya jika tidak ingin mengganti.' : 'Key disimpan terenkripsi dan tidak ditampilkan kembali secara utuh.'}
                  sx={{ mb: 2 }}
                />
              </CardContent>
            </Card>

            {/* DeepSeek Direct API */}
            <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>DeepSeek Direct · lebih hemat 90%</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  API langsung DeepSeek untuk chat AI. Lebih murah ($0.27/M input) dan cepat. Buat key di{' '}
                  <Link href="https://platform.deepseek.com" target="_blank" rel="noopener">platform.deepseek.com</Link>.
                </Typography>

                <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
                  <InputLabel>Provider Chat AI</InputLabel>
                  <Select
                    value={chatProvider}
                    label="Provider Chat AI"
                    onChange={e => { setChatProvider(e.target.value); void loadChatModels(e.target.value); }}
                  >
                    <MenuItem value="deepseek-direct">DeepSeek Direct (rekomendasi — hemat)</MenuItem>
                    <MenuItem value="openrouter">OpenRouter (supermarket model)</MenuItem>
                  </Select>
                </FormControl>

                {chatProvider === 'deepseek-direct' && (
                  <TextField
                    label="API Key DeepSeek"
                    size="small"
                    type="password"
                    fullWidth
                    value={deepseekKey}
                    onChange={e => setDeepseekKey(e.target.value)}
                    placeholder="sk-..."
                    helperText={deepseekKey.includes('*') ? 'API key sudah tersimpan.' : 'Key disimpan terenkripsi.'}
                  />
                )}
              </CardContent>
            </Card>

            <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Model pemahaman gambar</Typography>
                      {visionModels.length > 0 && <Chip size="small" label={`${visionModels.length} model vision`} color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">Menganalisis gambar pelanggan melalui OpenRouter. Hasilnya tampil di Inbox dan selalu menunggu verifikasi CS.</Typography>
                  </Box>
                  <Button size="small" onClick={loadVisionModels} disabled={visionModelsLoading} sx={{ flexShrink: 0 }}>
                    {visionModelsLoading ? 'Memuat…' : 'Muat model vision'}
                  </Button>
                </Stack>

                {visionModels.length > 0 ? (
                  <FormControl fullWidth size="small">
                    <InputLabel>Model vision OpenRouter</InputLabel>
                    <Select value={visionModel} label="Model vision OpenRouter" onChange={e => setVisionModel(e.target.value)} displayEmpty>
                      {!visionModel && <MenuItem value=""><em>Pilih model vision</em></MenuItem>}
                      {!visionModels.some(model => model.id === visionModel) && visionModel && <MenuItem value={visionModel}>{visionModel} (tersimpan)</MenuItem>}
                      {visionModels.map(model => (
                        <MenuItem key={model.id} value={model.id}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <Typography variant="body2">{model.name || model.id}</Typography>
                            <Typography variant="caption" color="text.secondary">{model.id}</Typography>
                          </Stack>
                        </MenuItem>
                      ))}
                    </Select>
                    <FormHelperText>Pilih model yang menerima input gambar. Tanpa pilihan ini, gambar tetap diteruskan ke CS tanpa analisis otomatis.</FormHelperText>
                  </FormControl>
                ) : visionModelsLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}><CircularProgress size={16} /><Typography variant="caption">Memuat model vision…</Typography></Box>
                ) : visionModel ? (
                  <TextField fullWidth size="small" label="Model vision" value={visionModel} disabled helperText={visionModelsError || 'Klik Muat model vision untuk memperbarui katalog.'} />
                ) : (
                  <Alert severity="info">{visionModelsError || 'Pilih model vision agar AI dapat menganalisis gambar pelanggan.'}</Alert>
                )}
              </CardContent>
            </Card>

            <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Model percakapan</Typography>
                      {chatModels.length > 0 && (
                        <Chip size="small" label={`${chatModels.length} model`} color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">Model yang dipakai untuk membalas chat pelanggan dan fitur AI lainnya.</Typography>
                  </Box>
                  <Button size="small" onClick={() => loadChatModels()} disabled={chatModelsLoading} sx={{ flexShrink: 0 }}>
                    {chatModelsLoading ? 'Memuat…' : 'Muat ulang model'}
                  </Button>
                </Stack>

                {chatModels.length > 0 ? (
                  <FormControl fullWidth size="small">
                    <InputLabel>{chatModelLabel}</InputLabel>
                    <Select
                      value={chatModelValue}
                      label={chatModelLabel}
                      onChange={e => setChatModelValue(e.target.value)}
                    >
                      {!chatModels.some(m => m.id === chatModelValue) && chatModelValue && (
                        <MenuItem value={chatModelValue}>{chatModelValue}{' '}<Typography component="span" variant="caption" color="text.secondary">(tersimpan)</Typography></MenuItem>
                      )}
                      {chatModels.map(m => (
                        <MenuItem key={m.id} value={m.id}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                            <Typography variant="body2">{m.name || m.id}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{m.id}</Typography>
                          </Stack>
                        </MenuItem>
                      ))}
                    </Select>
                    <FormHelperText>
                      Model diambil langsung dari katalog {chatProviderName}. Ganti kapan saja — perubahan langsung aktif tanpa restart.
                    </FormHelperText>
                  </FormControl>
                ) : chatModelsLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">Memuat daftar model dari {chatProviderName}…</Typography>
                  </Box>
                ) : chatModelValue ? (
                  <TextField
                    fullWidth
                    size="small"
                    label="Model chat"
                    value={chatModelValue}
                    disabled
                    helperText={chatModelsError || `Klik "Muat ulang model" untuk mengambil daftar terbaru dari ${chatProviderName}.`}
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {chatModelsError || 'Simpan API key terlebih dahulu, lalu klik "Muat ulang model".'}
                  </Typography>
                )}
              </CardContent>
            </Card>

            <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Model embedding knowledge</Typography>
                    <Typography variant="caption" color="text.secondary">Dipakai untuk memahami kemiripan makna, bukan sekadar kata yang sama.</Typography>
                  </Box>
                  <Button size="small" onClick={loadEmbeddingModels} disabled={embeddingModelsLoading} sx={{ flexShrink: 0 }}>
                    {embeddingModelsLoading ? 'Memuat…' : 'Muat ulang model'}
                  </Button>
                </Stack>

                {embeddingModels.length > 0 ? (
                  <FormControl fullWidth size="small">
                    <InputLabel>Model embedding OpenRouter</InputLabel>
                    <Select
                      value={embeddingModel}
                      label="Model embedding OpenRouter"
                      onChange={e => setEmbeddingModel(e.target.value)}
                    >
                      {!embeddingModels.some(m => m.id === embeddingModel) && embeddingModel && (
                        <MenuItem value={embeddingModel}>{embeddingModel}{' '}<Typography component="span" variant="caption" color="text.secondary">(tersimpan)</Typography></MenuItem>
                      )}
                      {embeddingModels.map(m => (
                        <MenuItem key={m.id} value={m.id}>
                          {m.name || m.id}
                        </MenuItem>
                      ))}
                    </Select>
                    <FormHelperText>
                      Model diambil langsung dari katalog OpenRouter. Saat diganti, knowledge lama di-embedding ulang otomatis.
                    </FormHelperText>
                  </FormControl>
                ) : embeddingModelsLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">Memuat daftar model embedding…</Typography>
                  </Box>
                ) : embeddingModel ? (
                  <TextField
                    fullWidth
                    size="small"
                    label="Model embedding"
                    value={embeddingModel}
                    disabled
                    helperText={embeddingModelsError || 'Klik "Muat ulang model" untuk mengambil daftar terbaru.'}
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {embeddingModelsError || 'Simpan API key terlebih dahulu, lalu klik "Muat ulang model".'}
                  </Typography>
                )}
              </CardContent>
            </Card>

            <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Button
                variant="contained"
                onClick={saveAPIConfigOnly}
                disabled={!apiKey}
                startIcon={<AutoAwesomeIcon />}
                fullWidth
                sx={{ fontWeight: 700 }}
              >
                Simpan konfigurasi AI
              </Button>
            </Box>
          </Box>
        )}

        {tab === 'settings' && (
          <Box>
            <PageHeader
              title={<><SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />Pengaturan {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>}
              subtitle="Atur otomasi percakapan dan pengelolaan nomor. Persona serta pengetahuan bisnis ada di menu Asisten AI."
            />

            <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Accordion disableGutters elevation={0} defaultExpanded={greetEnabled || bhEnabled} sx={{ border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Otomasi percakapan</Typography>
                      <Typography variant="caption" color="text.secondary">Sapaan dan respons di luar jam kerja.</Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0 }}>
                    <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Sapaan Otomatis</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                      Pesan pembuka sekali saat kontak baru pertama chat.
                    </Typography>
                    <FormControlLabel control={<Switch checked={greetEnabled} onChange={e => setGreetEnabled(e.target.checked)} />} label="Aktifkan" />
                    <TextField fullWidth multiline rows={2} size="small" label="Pesan sapaan" value={greetMsg}
                      onChange={e => setGreetMsg(e.target.value)} disabled={!greetEnabled} sx={{ mt: 0.75 }}
                      placeholder="Halo kak! Ada yang bisa dibantu? 😊" />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Jam Kerja</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                      Di luar jam kerja bot tidak jawab pakai AI, hanya kirim pesan otomatis sekali.
                    </Typography>
                    <FormControlLabel control={<Switch checked={bhEnabled} onChange={e => setBhEnabled(e.target.checked)} />} label="Batasi jam kerja" />
                    <Stack direction="row" spacing={1} sx={{ my: 0.75 }}>
                      <TextField type="time" label="Mulai" size="small" value={bhStart} onChange={e => setBhStart(e.target.value)}
                        disabled={!bhEnabled} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
                      <TextField type="time" label="Selesai" size="small" value={bhEnd} onChange={e => setBhEnd(e.target.value)}
                        disabled={!bhEnabled} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
                    </Stack>
                    <TextField fullWidth multiline rows={2} size="small" label="Pesan di luar jam kerja" value={awayMsg}
                      onChange={e => setAwayMsg(e.target.value)} disabled={!bhEnabled}
                      placeholder="Mohon maaf, kami sedang di luar jam operasional. Pesan kakak akan kami balas pada jam kerja ya 🙏" />
                  </Grid>
                    </Grid>
                  </AccordionDetails>
                </Accordion>

                <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', minHeight: 36 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minHeight: 24 }}>
                      {settingsBaseline !== null && !hasUnsavedSettings && <CheckCircleIcon color="success" fontSize="small" />}
                      <Typography variant="caption" color={hasUnsavedSettings ? 'warning.main' : 'text.secondary'} sx={{ fontWeight: 600 }}>
                        {settingsBaseline === null
                          ? 'Memuat pengaturan...'
                          : hasUnsavedSettings
                            ? 'Ada perubahan yang belum disimpan'
                            : 'Semua perubahan tersimpan'}
                      </Typography>
                    </Stack>
                    <Button
                      variant={hasUnsavedSettings ? 'contained' : 'outlined'}
                      onClick={saveAgent}
                      disabled={settingsBaseline === null || !hasUnsavedSettings || saveAgentMut.isPending}
                      startIcon={saveAgentMut.isPending ? <CircularProgress size={15} color="inherit" /> : undefined}
                      sx={{ minWidth: 170 }}
                    >
                      Simpan perubahan
                    </Button>
                  </Stack>
                </Box>
              </CardContent>
            </Card>

            <Card sx={{ border: '1px solid #f5c2c7' }}>
              <CardContent>
                <Typography variant="subtitle2" color="error" sx={{ mb: 1 }}>Zona Berbahaya</Typography>
                <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={deleteAgent} disabled={deleteAgentMut.isPending}>Hapus CS ini</Button>
              </CardContent>
            </Card>
          </Box>
        )}

        {tab === 'handoff' && (
          <Box>
            <PageHeader
              title={<>Butuh CS ({handoffs.length})</>}
              subtitle="Antrian internal untuk kontak yang perlu penanganan manusia. Ke pelanggan, asisten tetap tampak sebagai CS yang sama (tidak bilang diteruskan ke petugas)."
            />
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Aturan otomatis (soft handoff)</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.25, '& li': { mb: 0.35 } }}>
                <li>
                  <Typography variant="body2" component="span">
                    <b>Sementara menunggu CS:</b> asisten masih boleh menjawab sapaan & info umum dari knowledge. Topik sensitif (refund, komplain berat, dll.) ditahan dengan “saya cek dulu…”.
                  </Typography>
                </li>
                <li>
                  <Typography variant="body2" component="span">
                    <b>CS sudah membalas</b> (dari inbox/HP): asisten <b>diam</b> agar tidak menimpa percakapan manusia.
                  </Typography>
                </li>
                <li>
                  <Typography variant="body2" component="span">
                    <b>2 jam tanpa balasan CS:</b> antrian otomatis dilepas dan asisten kembali melayani penuh (agar pelanggan tidak terbengkalai).
                  </Typography>
                </li>
                <li>
                  <Typography variant="body2" component="span">
                    <b>Selesaikan penanganan</b> kapan saja untuk segera mengembalikan otomatisasi tanpa menunggu 2 jam.
                  </Typography>
                </li>
              </Box>
            </Alert>
            {handoffs.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">Tidak ada antrian. Semua sudah ditangani.</Typography>
              </Paper>
            ) : (
              <Stack spacing={1.5}>
                {handoffs.map((h) => (
                  <Paper key={h.id} variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>{h.sender}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>&ldquo;{h.last_msg}&rdquo;</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                        Soft mode aktif: FAQ tetap bisa dijawab asisten. Tanpa balasan CS dalam <b>2 jam</b>, asisten kembali full otomatis.
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <Button size="small" variant="outlined" onClick={() => { setSeed({ kind: 'inbox', value: h.sender, n: Date.now() }); setTab('inbox'); }}>
                        Balas
                      </Button>
                      <Button size="small" color="success" variant="contained" onClick={() => resumeHandoff.mutate(h.sender)}>
                        Selesaikan penanganan
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
        )}
        {tab === 'inbox' && (
          <Box sx={{ flex: 1, minHeight: 0, height: { xs: 'calc(100dvh - 56px)', md: '100%' }, display: 'flex', flexDirection: 'column' }}>
            <InboxPanel agentId={agentId} aiEnabled={aiEnabled} seed={seed?.kind === 'inbox' ? seed : null} />
          </Box>
        )}
        {tab === 'coba-chat' && <TestChatPanel agentId={agentId} />}
        {tab === 'grup' && <GroupGuardPanel agentId={agentId} />}
        {tab === 'broadcast' && <BroadcastPanel agentId={agentId} seed={seed?.kind === 'broadcast' ? seed : null} />}
        {tab === 'kalender' && <CalendarPanel agentId={agentId} />}
        {tab === 'auto-reply' && <AutoReplyPanel agentId={agentId} />}
        {tab === 'template' && <TemplatePanel agentId={agentId} />}
        {tab === 'follow-up' && <FollowUpPanel agentId={agentId} />}
        {tab === 'produk' && <ProductPanel agentId={agentId} />}
        {tab === 'alur' && <FlowPanel agentId={agentId} />}
        {tab === 'api' && <ApiPanel agentId={agentId} onOpenDashboard={() => setTab('dashboard')} />}
        {tab === 'widget' && <WidgetPanel agentId={agentId} />}
        {tab === 'status' && <StatusPanel agentId={agentId} />}
        {tab === 'kontak' && (
          <ContactsPanel agentId={agentId}
            onBroadcast={(recipients) => { setSeed({ kind: 'broadcast', value: recipients, n: Date.now() }); setTab('broadcast'); }}
            onOpenChat={(number) => { setSeed({ kind: 'inbox', value: number, n: Date.now() }); setTab('inbox'); }} />
        )}
      </Box>

      {/* Modal tautkan WhatsApp: dua metode — Scan QR & Kode Pasangan */}
      <Dialog open={qrModalOpen} onClose={() => setQrModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ textAlign: 'center', pb: 0.5 }}>
          {status === 'connected' ? 'WhatsApp Tertaut' : 'Tautkan WhatsApp'}
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          {status === 'connected' ? (
            <Box sx={{ py: 3 }}>
              <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main' }} />
              <Typography sx={{ mt: 1, fontWeight: 600 }}>{waName || 'Tersambung'}{waNumber ? ` · +${waNumber}` : ''}</Typography>
              <Typography variant="caption" color="text.secondary">Berhasil tersambung. Menutup otomatis…</Typography>
            </Box>
          ) : (
            <>
              {/* Dua kartu pilihan metode: Scan QR vs Kode Pasangan */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
                <Paper
                  onClick={() => { setConnectMethod('qr'); setQrError(''); }}
                  sx={{
                    flex: 1, p: 1.5, cursor: 'pointer', textAlign: 'center',
                    border: '2px solid',
                    borderColor: connectMethod === 'qr' ? 'success.main' : 'divider',
                    bgcolor: connectMethod === 'qr' ? 'rgba(37,211,102,0.06)' : 'transparent',
                    borderRadius: 2, transition: 'all 0.15s',
                    '&:hover': { borderColor: 'success.light' },
                  }}
                >
                  <QrCodeIcon sx={{ fontSize: 32, color: connectMethod === 'qr' ? 'success.main' : 'action.disabled' }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 0.5 }}>Scan QR</Typography>
                  <Typography variant="caption" color="text.secondary">Buka kamera HP · scan kode</Typography>
                </Paper>
                <Paper
                  onClick={() => { setConnectMethod('pairing'); setQrError(''); }}
                  sx={{
                    flex: 1, p: 1.5, cursor: 'pointer', textAlign: 'center',
                    border: '2px solid',
                    borderColor: connectMethod === 'pairing' ? 'success.main' : 'divider',
                    bgcolor: connectMethod === 'pairing' ? 'rgba(37,211,102,0.06)' : 'transparent',
                    borderRadius: 2, transition: 'all 0.15s',
                    '&:hover': { borderColor: 'success.light' },
                  }}
                >
                  <DialpadIcon sx={{ fontSize: 32, color: connectMethod === 'pairing' ? 'success.main' : 'action.disabled' }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 0.5 }}>Kode Pasangan</Typography>
                  <Typography variant="caption" color="text.secondary">Ketik kode 8 digit di WA</Typography>
                </Paper>
              </Stack>

              {connectMethod === 'qr' ? (
                status === 'expired' ? (
                  <Box sx={{ py: 4, px: 2 }}>
                    <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600, mb: 0.5 }}>Kode kedaluwarsa</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Jendela scan sudah habis. Klik "Muat ulang QR" untuk membuat kode baru.
                    </Typography>
                  </Box>
                ) : qr ? (
                  <>
                    {riskAck ? (
                      <>
                        <Box sx={{ bgcolor: '#fff', p: 1.5, borderRadius: 2, display: 'inline-block', mt: 1, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                          <QRCodeSVG value={qr} size={220} level="L" includeMargin />
                        </Box>
                        <Box sx={{ mt: 1.5, px: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>Buka WhatsApp di HP</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Setelan → Perangkat Tertaut → Tautkan Perangkat, lalu arahkan kamera ke QR ini.
                          </Typography>
                        </Box>
                        <Box sx={{ mt: 1.5 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {qrSeconds > 0 ? `QR aktif. Kode diperbarui otomatis (${qrSeconds} detik). Scan kapan saja.` : 'Memuat kode baru…'}
                          </Typography>
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ py: 5, px: 2 }}>
                        <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
                          Centang persetujuan di bawah untuk menampilkan QR.
                        </Typography>
                      </Box>
                    )}
                  </>
                ) : qrError ? (
                  <Box sx={{ py: 4, px: 2 }}>
                    <Typography variant="body2" color="error" sx={{ fontWeight: 600, mb: 0.5 }}>Gagal menyiapkan QR</Typography>
                    <Typography variant="caption" color="text.secondary">{qrError}</Typography>
                  </Box>
                ) : (
                  <Box sx={{ py: 4 }}>
                    <CircularProgress />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Menyiapkan QR…</Typography>
                  </Box>
                )
              ) : (
                /* Metode kode pairing */
                pairCode ? (
                  <Box sx={{ py: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Masukkan kode ini di WhatsApp</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 32, fontWeight: 700, letterSpacing: 4 }}>
                      {pairCode.length === 8 ? `${pairCode.slice(0, 4)}-${pairCode.slice(4)}` : pairCode}
                    </Typography>
                    <Box sx={{ mt: 1.5, px: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Setelan → Perangkat Tertaut → Tautkan Perangkat → <b>Tautkan dengan nomor telepon</b>, lalu ketik kode di atas.
                      </Typography>
                    </Box>
                  </Box>
                ) : (status === 'connecting' || pairMut.isPending) ? (
                  <Box sx={{ py: 4 }}>
                    <CircularProgress />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Membuat kode…</Typography>
                  </Box>
                ) : (
                  <Box sx={{ py: 1 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Nomor WhatsApp"
                      placeholder="08123456789"
                      value={pairPhone}
                      onChange={e => setPairPhone(e.target.value)}
                      disabled={!riskAck}
                      sx={{ mt: 1 }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, textAlign: 'left' }}>
                      Masukkan nomor yang WhatsApp-nya ingin ditautkan. Boleh format 08xx atau 62xx.
                    </Typography>
                    {(pairError || qrError) && (
                      <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1, textAlign: 'left' }}>
                        {qrError || pairError}
                      </Typography>
                    )}
                  </Box>
                )
              )}

              <FormControlLabel
                sx={{ mt: 1, alignItems: 'flex-start', mx: 0 }}
                control={<Checkbox checked={riskAck} onChange={e => setRiskAck(e.target.checked)} size="small" color={riskAck ? 'primary' : 'error'} sx={{ py: 0, pl: 0 }} />}
                label={
                  <Typography variant="caption" color={riskAck ? 'text.secondary' : 'error'} sx={{ textAlign: 'left', display: 'block', lineHeight: 1.4 }}>
                    Saya paham WhatsApp saya berisiko diblokir dan WhatsApp Blast Source tidak bertanggung jawab atas hal itu.
                  </Typography>
                }
              />
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 2 }}>
          <Button onClick={() => setQrModalOpen(false)}>{status === 'connected' ? 'Selesai' : 'Tutup'}</Button>
          {status !== 'connected' && connectMethod === 'qr' && (
            <Button onClick={connect} disabled={connectMut.isPending || !riskAck} startIcon={<QrCodeIcon />}>Muat ulang QR</Button>
          )}
          {status !== 'connected' && connectMethod === 'pairing' && (
            <Button onClick={connectPairing} disabled={pairMut.isPending || !riskAck || !pairPhone.trim()} startIcon={<DialpadIcon />}>
              {pairCode ? 'Buat Ulang Kode' : 'Buat Kode'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={showGuardModal} onClose={() => setShowGuardModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>⚠️ Lengkapi dulu sebelum aktifkan AI</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Agar AI tidak blunder saat membalas pelanggan, pastikan 2 hal ini:
          </Typography>
          <Stack spacing={1.5}>
            {['System Prompt / Persona', 'Tone / gaya bahasa'].map((item) => {
              const isMissing = guardMissing.includes(item);
              return (
                <Paper key={item} variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, borderColor: isMissing ? 'error.light' : 'success.light' }}>
                  <Typography sx={{ fontSize: 18 }}>{isMissing ? '❌' : '✅'}</Typography>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{item}</Typography>
                    <Typography variant="caption" color="text.secondary">{isMissing ? 'Belum diisi' : 'Sudah lengkap'}</Typography>
                  </Box>
                  {isMissing && item.includes('Persona') && (
                    <Button size="small" variant="outlined" onClick={() => { setShowGuardModal(false); openAgentAI('persona'); }}>Isi</Button>
                  )}
                </Paper>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="success" startIcon={<AutoAwesomeIcon />} onClick={() => { setShowGuardModal(false); setWizardOpen(true); }}>Setup Cepat</Button>
          <Button onClick={() => setShowGuardModal(false)}>Nanti saja</Button>
        </DialogActions>
      </Dialog>



      <Popover
        open={!!profileAnchor}
        anchorEl={profileAnchor}
        onClose={() => setProfileAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, minWidth: 220 } } }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: 'primary.main', width: 40, height: 40, fontSize: 16 }}>
              {(user.name || user.username || 'U').charAt(0).toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{user.name || user.username}</Typography>
              <Typography variant="caption" color="text.secondary">{user.email || '—'}</Typography>
              {user.phone && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>+{user.phone}</Typography>}
            </Box>
          </Stack>
          {user.role && (
            <Chip label={user.role === 'admin' ? 'Super Admin' : user.role === 'owner' ? 'Owner' : user.role}
              size="small" color={user.role === 'admin' ? 'error' : 'primary'} variant="outlined" sx={{ alignSelf: 'flex-start' }} />
          )}
        </Stack>
      </Popover>

      <Dialog open={manageOpen} onClose={() => setManageOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Kelola Customer Service</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary">
            {agents.length} nomor terdaftar.
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {agents.map(a => (
              <Paper key={a.id} variant="outlined" sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: dotColor(statusMap[a.id]), flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.name || `CS ${a.id}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {statusMap[a.id] === 'connected' ? 'Tersambung' : 'Belum tersambung'}
                  </Typography>
                </Box>
                {a.id === agentId && <Chip label="aktif" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.68rem' }} />}
                <Tooltip title={agents.length <= 1 ? 'Minimal harus ada 1 CS' : 'Hapus CS'}>
                  <span>
                    <IconButton size="small" color="error" disabled={agents.length <= 1 || deleteAgentMut.isPending}
                      onClick={() => deleteAgentById(a.id, a.name)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManageOpen(false)}>Tutup</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAddAgent} disabled={createAgentMut.isPending}>
            Tambah CS
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Tambah Customer Service</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small" sx={{ mt: 1 }}
            label="Nama Customer Service Baru"
            placeholder="mis. Toko HP, Admin Olshop"
            value={newAgentName}
            onChange={e => { setNewAgentName(e.target.value); if (addError) setAddError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') submitNewAgent(); }}
            error={!!addError}
            helperText={addError || 'Nama ini muncul di daftar CS untuk membedakan tiap nomor.'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={submitNewAgent} disabled={createAgentMut.isPending}>Simpan</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={profileModalOpen} onClose={() => setProfileModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Profil</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nama" size="small" fullWidth value={profileName} onChange={e => setProfileName(e.target.value)} autoFocus />
            <TextField label="Email" size="small" fullWidth value={user.email || ''} disabled helperText="Email tidak bisa diubah" />
            <TextField label="Nomor WhatsApp" size="small" fullWidth value={user.phone ? `+${user.phone}` : '—'} disabled helperText="Nomor tidak bisa diubah" />
            <Divider />
            <Typography variant="caption" color="text.secondary">Ganti password (isi hanya jika ingin mengganti)</Typography>
            <TextField label="Password lama" size="small" type="password" fullWidth value={profileOldPassword} onChange={e => setProfileOldPassword(e.target.value)} />
            <TextField label="Password baru" size="small" type="password" fullWidth value={profileNewPassword} onChange={e => setProfileNewPassword(e.target.value)} helperText="Minimal 8 karakter" />
            <Divider />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Lisensi</Typography>
            <TextField label="License Key" size="small" fullWidth value={localStorage.getItem('licenseKeyHint') || '(tersimpan di .env)'} disabled helperText="Lisensi tersimpan di .env." />
            <Alert severity="info" sx={{ mt: 0.5 }}>
              <Typography variant="caption">
                Konfigurasi OpenRouter (model AI & API key) dipindahkan ke menu <b>AI & Model</b> di sidebar.
              </Typography>
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProfileModalOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={saveProfile} disabled={profileSaving || !profileName.trim()}>
            {profileSaving ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal contoh persona/profil bisnis */}
      <Dialog open={exampleModalOpen} onClose={() => setExampleModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{exampleMode === 'prompt' ? 'Contoh Persona AI' : 'Contoh Profil Bisnis'}</DialogTitle>
        <DialogContent>
          {exampleMode === 'profile' && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, mt: 1 }}>Profil Bisnis (Setup Cepat)</Typography>
              <Box component="pre" sx={{ bgcolor: 'grey.50', p: 1.5, borderRadius: 1, fontSize: '0.75rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', border: '1px solid', borderColor: 'divider', mb: 2 }}>
{`Jenis Bisnis: Produk Fisik
Nama Bisnis: AromaLuxe Parfum
Produk/Layanan: Parfum pria dan wanita, parfum inspired, body mist, eau de parfum, dan paket bundling parfum.
Range Harga: Rp35.000 - Rp180.000 per botol. Paket bundling mulai Rp100.000.
Nama CS: Admin AromaLuxe
Cara Order: Pelanggan bisa order melalui WhatsApp dengan menyebutkan varian parfum, ukuran botol, jumlah pesanan, nama penerima, alamat lengkap, dan metode pembayaran.
Pembayaran: Transfer BCA, Mandiri, QRIS, dan COD khusus area tertentu.
Pengiriman: JNE, J&T, SiCepat, Shopee Express, atau kurir instan untuk area tertentu. Estimasi 1-5 hari kerja.
Lokasi: Bandung, Jawa Barat. Melayani pengiriman ke seluruh Indonesia.
Jam Operasional: 08:00-21:00`}
              </Box>
            </>
          )}

          {exampleMode === 'prompt' && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, mt: 1 }}>Persona AI</Typography>
              <Box component="pre" sx={{ bgcolor: 'grey.50', p: 1.5, borderRadius: 1, fontSize: '0.75rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', border: '1px solid', borderColor: 'divider', maxHeight: 400, overflowY: 'auto' }}>
{`Kamu adalah Admin AromaLuxe, customer service WhatsApp untuk toko parfum bernama AromaLuxe Parfum.

Tugas utama kamu adalah membantu pelanggan dengan ramah, cepat, jelas, dan persuasif untuk:
1. Menjawab pertanyaan tentang produk parfum.
2. Membantu rekomendasi aroma sesuai kebutuhan pelanggan.
3. Mengecek minat pelanggan terhadap varian, ukuran, dan jumlah pesanan.
4. Mengarahkan pelanggan untuk melakukan order.
5. Meminta data pemesanan secara lengkap.
6. Menjelaskan harga, pengiriman, dan cara pembayaran.
7. Mengarahkan ke admin manusia jika ada pertanyaan di luar informasi yang tersedia.

PROFIL BISNIS:
- Nama bisnis: AromaLuxe Parfum
- Jenis bisnis: Produk fisik
- Produk: Parfum pria dan wanita, parfum inspired, body mist, eau de parfum, dan paket bundling parfum.
- Range harga: Rp35.000 - Rp180.000 per botol. Paket bundling mulai Rp100.000.
- Nama CS: Admin AromaLuxe
- Jam operasional: 08:00-21:00
- Pengiriman: JNE, J&T, SiCepat, Shopee Express, dan kurir instan untuk area tertentu.
- Estimasi pengiriman: 1-5 hari kerja tergantung lokasi.

ATURAN PENTING:
1. Jangan mengarang informasi bisnis yang belum tersedia.
2. Jika suatu detail belum bisa dipastikan, sampaikan secara natural tanpa menyebut AI, bot, sistem, data, knowledge, atau basis pengetahuan.
3. Jangan memberikan klaim berlebihan.
4. Jika pelanggan komplain, tanggapi dengan empati dan minta detail pesanan.
5. Jika pelanggan ingin bicara dengan manusia, arahkan ke admin.
6. Jika pelanggan bertanya di luar produk, jawab singkat dan kembalikan ke topik parfum.

CARA MENJAWAB REKOMENDASI:
Jika pelanggan bingung memilih aroma, tanyakan:
- Untuk pria atau wanita?
- Suka aroma fresh, manis, elegan, soft, maskulin, floral, fruity, atau vanilla?
- Dipakai untuk harian, kerja, kuliah, acara formal, atau hadiah?

ALUR ORDER:
Jika pelanggan ingin membeli, minta data: nama, no. HP, produk/varian, ukuran, jumlah, alamat lengkap, kecamatan/kota, metode pembayaran.

CARA MENJAWAB HARGA:
"Harga parfum AromaLuxe mulai dari Rp35.000 sampai Rp180.000 per botol, tergantung ukuran dan varian. Paket bundling mulai dari Rp100.000 ya Kak."

CARA MENJAWAB PENGIRIMAN:
"Pengiriman bisa menggunakan JNE, J&T, SiCepat, Shopee Express, atau kurir instan. Estimasi 1-5 hari kerja tergantung lokasi Kak."

TUJUAN AKHIR:
Bantu pelanggan sampai jelas, tertarik, dan siap order. Jika pelanggan sudah menunjukkan minat, arahkan dengan lembut ke proses pemesanan. Jangan memaksa.`}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExampleModalOpen(false)}>Tutup</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editingKnowledge} onClose={() => setEditingKnowledge(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit FAQ</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <TextField size="small" label="Pertanyaan" value={editingKnowledgeDraft.question}
              onChange={e => setEditingKnowledgeDraft(d => ({ ...d, question: e.target.value }))} />
            <TextField size="small" label="Jawaban" multiline minRows={4} value={editingKnowledgeDraft.answer}
              onChange={e => setEditingKnowledgeDraft(d => ({ ...d, answer: e.target.value }))} />
            <TextField size="small" label="Tags (pisahkan dengan koma)" value={editingKnowledgeDraft.tags}
              onChange={e => setEditingKnowledgeDraft(d => ({ ...d, tags: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingKnowledge(null)} disabled={updateKnowledgeMut.isPending}>Batal</Button>
          <Button variant="contained" disabled={!editingKnowledgeDraft.question.trim() || !editingKnowledgeDraft.answer.trim() || updateKnowledgeMut.isPending}
            onClick={async () => {
              if (!editingKnowledge) return;
              try {
                await updateKnowledgeMut.mutateAsync({ id: editingKnowledge.id, ...editingKnowledgeDraft });
                setEditingKnowledge(null);
                swalToast('FAQ diperbarui', 'success');
              } catch (error) {
                const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'FAQ belum bisa diperbarui';
                swalToast(message, 'error');
              }
            }}>
            {updateKnowledgeMut.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Setup Wizard */}
      <Dialog open={wizardOpen} onClose={() => setWizardOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeIcon color="success" /> Setup Cepat
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Isi profil bisnis di bawah. Sistem akan membuat persona AI dan FAQ awal secara otomatis.
          </Typography>
          {knowledge.length > 0 && (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              Persona akan diperbarui. FAQ serupa dari sumber lain digabung otomatis, sedangkan FAQ Manual tetap menjadi prioritas utama.
            </Alert>
          )}
          <Grid container spacing={1}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Nama Bisnis *" value={wizardBiz.biz_name}
                onChange={e => setWizardBiz({...wizardBiz, biz_name: e.target.value})} required />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Jenis Bisnis</InputLabel>
                <Select value={wizardBiz.biz_type} label="Jenis Bisnis"
                  onChange={e => setWizardBiz({...wizardBiz, biz_type: e.target.value})}>
                  <MenuItem value="produk_fisik">Produk Fisik</MenuItem>
                  <MenuItem value="produk_digital">Produk Digital</MenuItem>
                  <MenuItem value="jasa">Jasa/Layanan</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={12}>
              <TextField fullWidth size="small" label="Produk/Layanan *" value={wizardBiz.products}
                onChange={e => setWizardBiz({...wizardBiz, products: e.target.value})}
                placeholder="mis: Baju muslim, gamis, hijab..." multiline rows={3} required
                helperText="Wajib diisi agar persona dan FAQ tidak terlalu umum." />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Range Harga" value={wizardBiz.price_range}
                onChange={e => setWizardBiz({...wizardBiz, price_range: e.target.value})}
                placeholder="Rp 50rb - 300rb" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Nama CS" value={wizardBiz.cs_name}
                onChange={e => setWizardBiz({...wizardBiz, cs_name: e.target.value})}
                placeholder="mis: Admin Maya" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Cara Order" value={wizardBiz.order_flow}
                onChange={e => setWizardBiz({...wizardBiz, order_flow: e.target.value})}
                placeholder="Pilih produk, kirim nama dan alamat, lalu konfirmasi pesanan" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Metode Pembayaran" value={wizardBiz.payment}
                onChange={e => setWizardBiz({...wizardBiz, payment: e.target.value})}
                placeholder="Transfer BCA, QRIS, COD area tertentu" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Pengiriman" value={wizardBiz.shipping}
                onChange={e => setWizardBiz({...wizardBiz, shipping: e.target.value})}
                placeholder="JNE/J&T, estimasi 1-3 hari kerja" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Lokasi / Area Layanan" value={wizardBiz.location}
                onChange={e => setWizardBiz({...wizardBiz, location: e.target.value})}
                placeholder="Bandung, melayani seluruh Indonesia" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Jam Operasional" value={wizardBiz.hours}
                onChange={e => setWizardBiz({...wizardBiz, hours: e.target.value})}
                placeholder="08:00 - 21:00" />
            </Grid>
            <Grid size={12}>
              <TextField fullWidth size="small" label="Kebijakan Penting" value={wizardBiz.policies}
                onChange={e => setWizardBiz({...wizardBiz, policies: e.target.value})}
                placeholder="Contoh: penukaran maksimal 3 hari jika barang cacat dan wajib menyertakan video unboxing"
                multiline rows={2} helperText="Kosongkan jika tidak ada. Jangan menulis kebijakan yang belum pasti." />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" variant="text" onClick={() => { setExampleMode('profile'); setExampleModalOpen(true); }}>Lihat contoh profil</Button>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setWizardOpen(false)} disabled={wizardLoading}>Batal</Button>
            <Button variant="contained" color="success" disabled={wizardLoading || !wizardBiz.biz_name.trim() || !wizardBiz.products.trim()}
            onClick={runSetupWizard}
            startIcon={wizardLoading ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}>
            {wizardLoading ? 'Menyiapkan...' : 'Buat Persona & FAQ'}
          </Button>
          </Stack>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
