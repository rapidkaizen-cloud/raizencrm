import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
  type ReactNode, type RefObject,
} from 'react';
import {
  Box, Typography, TextField, IconButton, Stack, Chip, Button, CircularProgress,
  Avatar, Dialog, DialogTitle, DialogContent, DialogActions, Alert, Collapse,
  Tooltip, InputAdornment, useMediaQuery, Drawer,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import ReplyIcon from '@mui/icons-material/Reply';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SearchIcon from '@mui/icons-material/Search';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import InsertEmoticonIcon from '@mui/icons-material/InsertEmoticon';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  useContacts, useConversation, useConversationBrief, useRefreshConversationBrief,
  useSendMessage, useSendMedia, postAgentTyping, useRevokeMessage, useResumeBot, useReanalyzeImage,
  useDeleteInboxConversation, useLoadOlderMessages,
} from '../hooks';
import TemplatePicker from './TemplatePicker';
import { swalConfirm, swalToast } from '../services/swal';
import type { ChatMsg, Contact, ConversationBrief } from '../types';

/* ─── WhatsApp Web palette ─────────────────────────────────────────────── */
const WA = {
  panel: '#ffffff',
  panelHeader: '#f0f2f5',
  listHover: '#f5f6f6',
  listActive: '#f0f2f5',
  chatBg: '#efeae2',
  bubbleIn: '#ffffff',
  bubbleOut: '#d9fdd3',
  bubbleOutCS: '#d9fdd3',
  green: '#00a884',
  greenDark: '#008069',
  meta: '#667781',
  border: '#e9edef',
  searchBg: '#f0f2f5',
  tick: '#53bdeb',
};

function MediaView({ agentId, m, token }: { agentId: number; m: ChatMsg; token: string }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const url = `/api/agents/${agentId}/media/${m.id}?token=${token}`;
  if (m.media_type === 'image' || m.media_type === 'sticker') {
    return (
      <>
        <Box
          component="img"
          src={url}
          alt=""
          onClick={() => setZoom(url)}
          sx={{ maxWidth: 240, maxHeight: 280, borderRadius: 1, display: 'block', cursor: 'pointer' }}
        />
        <Dialog open={!!zoom} onClose={() => setZoom(null)} maxWidth="md" onClick={() => setZoom(null)}>
          <Box component="img" src={zoom || ''} alt="" sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block' }} />
        </Dialog>
      </>
    );
  }
  if (m.media_type === 'audio') return <audio src={url} controls style={{ maxWidth: 240 }} />;
  if (m.media_type === 'video') {
    return <video src={url} controls style={{ maxWidth: 240, borderRadius: 8 }} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit', fontSize: 13 }}>
      📎 {m.file_name || 'Unduh file'}
    </a>
  );
}

function fmtTime(ts?: string) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtListTime(ts?: string) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString('id-ID', { weekday: 'short' });
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function mediaPreviewLabel(m: Pick<ChatMsg, 'message' | 'media_type' | 'file_name' | 'reply'>) {
  if (m.message) return m.message;
  if (m.reply) return m.reply;
  if (m.media_type === 'image' || m.media_type === 'sticker') return '📷 Foto';
  if (m.media_type === 'video') return '🎥 Video';
  if (m.media_type === 'audio') return '🎵 Audio';
  if (m.media_type === 'document') return `📄 ${m.file_name || 'Dokumen'}`;
  return 'Pesan';
}

function avatarColor(seed: string) {
  const colors = ['#00a884', '#53bdeb', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#ec4899'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

/* ─── Bubble (memo) ─────────────────────────────────────────────────────── */

const Bubble = memo(function Bubble({
  side, tag, time, name, replyTo, onReply, children, isCS,
}: {
  side: 'left' | 'right';
  tag?: string;
  time?: string;
  name?: string;
  replyTo?: string;
  onReply?: () => void;
  children: ReactNode;
  isCS?: boolean;
}) {
  const isLeft = side === 'left';
  return (
    <Box
      sx={{
        alignSelf: isLeft ? 'flex-start' : 'flex-end',
        maxWidth: { xs: '88%', sm: '72%', md: '65%' },
        display: 'flex',
        flexDirection: isLeft ? 'row' : 'row-reverse',
        alignItems: 'flex-end',
        gap: 0.5,
        '&:hover .reply-btn': { opacity: 1 },
      }}
    >
      <Box sx={{ position: 'relative', minWidth: 0 }}>
        {tag && (
          <Typography
            sx={{
              display: 'block',
              textAlign: isLeft ? 'left' : 'right',
              mb: 0.2,
              fontWeight: 600,
              fontSize: 10,
              color: tag === 'Bot' ? WA.greenDark : WA.meta,
              px: 0.25,
            }}
          >
            {tag === 'Bot' ? 'Asisten AI' : tag === 'CS' ? 'CS' : tag}
          </Typography>
        )}
        <Box
          sx={{
            px: 1.1,
            pt: 0.55,
            pb: 0.35,
            borderRadius: '7.5px',
            borderTopLeftRadius: isLeft ? '0' : '7.5px',
            borderTopRightRadius: isLeft ? '7.5px' : '0',
            bgcolor: isLeft ? WA.bubbleIn : WA.bubbleOut,
            color: '#111b21',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '0.925rem',
            lineHeight: 1.4,
            boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)',
          }}
        >
          {replyTo && (
            <Box
              sx={{
                borderLeft: '4px solid',
                borderColor: isLeft ? WA.green : '#06cf9c',
                pl: 0.85,
                py: 0.35,
                mb: 0.5,
                bgcolor: isLeft ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.05)',
                borderRadius: '0 4px 4px 0',
                fontSize: '0.8rem',
                lineHeight: 1.3,
                color: WA.meta,
                maxHeight: 52,
                overflow: 'hidden',
              }}
            >
              {replyTo}
            </Box>
          )}
          {children}
          <Stack
            direction="row"
            spacing={0.4}
            sx={{ justifyContent: 'flex-end', alignItems: 'center', mt: 0.15, minHeight: 16, gap: 0.35 }}
          >
            {time && (
              <Typography component="span" sx={{ fontSize: 11, color: WA.meta, lineHeight: 1, userSelect: 'none' }}>
                {time}
              </Typography>
            )}
            {!isLeft && isCS && (
              <Box component="span" sx={{ fontSize: 12, color: WA.tick, lineHeight: 1, letterSpacing: -1 }}>
                ✓✓
              </Box>
            )}
            <IconButton
              size="small"
              className="reply-btn"
              onClick={onReply}
              aria-label="Balas"
              sx={{ opacity: 0, transition: 'opacity 0.12s', p: 0.15, width: 18, height: 18 }}
            >
              <ReplyIcon sx={{ fontSize: 13, color: WA.meta }} />
            </IconButton>
          </Stack>
        </Box>
      </Box>
      {/* name unused visually in WA web — keep for a11y */}
      {name ? <Box component="span" sx={{ display: 'none' }}>{name}</Box> : null}
    </Box>
  );
});

function TypingIndicator() {
  return (
    <Box
      sx={{
        alignSelf: 'flex-start',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.5,
        py: 1.1,
        bgcolor: WA.bubbleIn,
        borderRadius: '7.5px',
        borderTopLeftRadius: 0,
        boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)',
        maxWidth: 72,
      }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: '#90a4ae',
            animation: 'typingBounce 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
            '@keyframes typingBounce': {
              '0%,60%,100%': { transform: 'translateY(0)', opacity: 0.4 },
              '30%': { transform: 'translateY(-5px)', opacity: 1 },
            },
          }}
        />
      ))}
    </Box>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, color: WA.meta, mb: 0.15 }}>{label}</Typography>
      <Typography sx={{ fontSize: 14.5, color: '#111b21', lineHeight: 1.35 }}>{value}</Typography>
    </Box>
  );
}

/* ─── Brief (compact, collapsed by default) ─────────────────────────────── */

const STAGE_LABEL: Record<string, string> = {
  new: 'Baru',
  info: 'Tanya info',
  interest: 'Minat',
  transaction: 'Order',
  issue: 'Keluhan',
  done: 'Selesai',
};

function stageColor(stage: string): 'default' | 'info' | 'success' | 'warning' | 'error' | 'primary' {
  switch (stage) {
    case 'issue': return 'error';
    case 'transaction': return 'primary';
    case 'interest': return 'info';
    case 'done': return 'success';
    default: return 'default';
  }
}

function ConversationBriefBar({
  brief, loading, refreshing, onRefresh, error,
}: {
  brief?: ConversationBrief;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);

  if (loading && !brief) {
    return (
      <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 0.85, alignItems: 'center', bgcolor: WA.panelHeader, borderBottom: `1px solid ${WA.border}` }}>
        <CircularProgress size={14} thickness={5} sx={{ color: WA.green }} />
        <Typography sx={{ fontSize: 12.5, color: WA.meta }}>Menyusun ringkasan…</Typography>
      </Stack>
    );
  }
  if (!brief && error) {
    return (
      <Alert
        severity="warning"
        sx={{ borderRadius: 0, py: 0.25 }}
        action={<Button size="small" onClick={onRefresh} disabled={refreshing}>Coba lagi</Button>}
      >
        Ringkasan belum bisa dimuat
      </Alert>
    );
  }
  if (!brief) return null;

  return (
    <Box sx={{ borderBottom: `1px solid ${WA.border}`, bgcolor: '#fff', flexShrink: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        onClick={() => setOpen((o) => !o)}
        sx={{
          px: 1.5,
          py: 0.75,
          alignItems: 'center',
          cursor: 'pointer',
          bgcolor: brief.needs_human || brief.stage === 'issue' ? alpha('#ed6c02', 0.06) : alpha(WA.green, 0.05),
          '&:hover': { bgcolor: alpha(WA.green, 0.08) },
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: 16, color: WA.greenDark }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.35 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 12.5, color: '#111b21' }} noWrap>
              {brief.intent || 'Ringkasan percakapan'}
            </Typography>
            <Chip size="small" color={stageColor(brief.stage)} label={STAGE_LABEL[brief.stage] || brief.stage} sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
            {brief.needs_human && <Chip size="small" color="warning" label="Butuh CS" sx={{ height: 18, fontSize: 10 }} />}
            {brief.stale && <Chip size="small" color="warning" variant="outlined" label="Ada chat baru" sx={{ height: 18, fontSize: 10 }} />}
          </Stack>
          {!open && brief.summary && (
            <Typography noWrap sx={{ fontSize: 11.5, color: WA.meta, mt: 0.1 }}>
              {brief.summary}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={0.15} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Perbarui ringkasan">
            <span>
              <IconButton size="small" onClick={onRefresh} disabled={refreshing} sx={{ p: 0.4 }}>
                {refreshing ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onClick={() => setOpen((o) => !o)} sx={{ p: 0.4 }}>
            {open ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ExpandMoreIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Stack>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ px: 1.5, pb: 1.1, maxHeight: 200, overflowY: 'auto' }}>
          {brief.summary && (
            <Typography sx={{ fontSize: 13, color: '#3b4a54', lineHeight: 1.45, mb: 0.75, whiteSpace: 'pre-wrap' }}>
              {brief.summary}
            </Typography>
          )}
          {(brief.open_items?.length || 0) > 0 && (
            <Box sx={{ mb: 0.75 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: WA.meta, mb: 0.35, textTransform: 'uppercase' }}>
                Perlu dikerjakan
              </Typography>
              {brief.open_items.map((item, i) => (
                <Typography key={i} sx={{ fontSize: 12.5, color: '#111b21', pl: 1, lineHeight: 1.4 }}>
                  {i + 1}. {item}
                </Typography>
              ))}
            </Box>
          )}
          {(brief.key_facts?.length || 0) > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: WA.meta, mb: 0.35, textTransform: 'uppercase' }}>
                Fakta
              </Typography>
              {brief.key_facts.map((item, i) => (
                <Typography key={i} sx={{ fontSize: 12.5, color: '#3b4a54', pl: 1, lineHeight: 1.4 }}>
                  • {item}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/* ─── Contact row (memo) ────────────────────────────────────────────────── */

const ContactRow = memo(function ContactRow({
  ct, selected, onSelect, onDelete, deleting,
}: {
  ct: Contact;
  selected: boolean;
  onSelect: (sender: string) => void;
  onDelete: (sender: string) => void;
  deleting?: boolean;
}) {
  const label = ct.name || `+${ct.sender}`;
  const initial = label.charAt(0).toUpperCase();
  return (
    <Box
      sx={{
        width: '100%',
        borderBottom: `1px solid ${WA.border}`,
        bgcolor: selected ? WA.listActive : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        pr: 0.5,
        '&:hover': { bgcolor: selected ? WA.listActive : WA.listHover },
        '&:hover .inbox-del-btn': { opacity: 1 },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onSelect(ct.sender)}
        sx={{
          appearance: 'none',
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          border: 0,
          bgcolor: 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 1.5,
          py: 1.1,
          cursor: 'pointer',
        }}
      >
        <Avatar
          sx={{
            width: 49,
            height: 49,
            fontSize: 18,
            fontWeight: 600,
            bgcolor: avatarColor(ct.sender),
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {initial}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1, border: 0 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 0.2 }}>
            <Typography noWrap sx={{ fontWeight: 500, fontSize: 16, color: '#111b21', lineHeight: 1.25 }}>
              {label}
            </Typography>
            <Typography sx={{ fontSize: 12, color: ct.needs_human ? WA.green : WA.meta, flexShrink: 0 }}>
              {fmtListTime(ct.last_at)}
            </Typography>
          </Stack>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 0.75 }}>
            <Typography
              noWrap
              sx={{ fontSize: 13.5, color: WA.meta, flex: 1, minWidth: 0, lineHeight: 1.3 }}
            >
              {ct.last_msg || (ct.name ? `+${ct.sender}` : ' ')}
            </Typography>
            {ct.needs_human ? (
              <Box
                sx={{
                  minWidth: 20,
                  height: 20,
                  px: 0.6,
                  borderRadius: 10,
                  bgcolor: WA.green,
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                !
              </Box>
            ) : ct.manual_pause_until && new Date(ct.manual_pause_until).getTime() > Date.now() ? (
              <Chip size="small" label="AI off" sx={{ height: 18, fontSize: 10, bgcolor: alpha('#53bdeb', 0.15), color: '#0288d1' }} />
            ) : null}
          </Stack>
        </Box>
      </Box>
      <Tooltip title="Hapus chat dari inbox">
        <span>
          <IconButton
            className="inbox-del-btn"
            size="small"
            disabled={deleting}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(ct.sender);
            }}
            aria-label={`Hapus chat ${label}`}
            sx={{
              opacity: { xs: 0.85, md: 0 },
              transition: 'opacity 0.12s',
              color: 'error.main',
              flexShrink: 0,
            }}
          >
            {deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
});

/* ─── Message list item ─────────────────────────────────────────────────── */

const MessageBlock = memo(function MessageBlock({
  m,
  agentId,
  mediaToken,
  selectedName,
  sender,
  replyLookup,
  onReply,
  onRevoke,
  onVision,
}: {
  m: ChatMsg;
  agentId: number;
  mediaToken: string;
  selectedName?: string;
  sender: string;
  replyLookup: Map<string, string>;
  onReply: (id: string, text: string) => void;
  onRevoke: (msgId: string) => void;
  onVision: (m: ChatMsg) => void;
}) {
  const resolveReply = (raw?: string) => {
    if (!raw) return '';
    if (m.reply_text) return m.reply_text;
    return replyLookup.get(raw) || '💬 Pesan';
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.45, px: { xs: 1, sm: 2.5, md: 4 } }}>
      {(m.message || (m.media_type && !m.from_human)) && (
        <Bubble
          side="left"
          time={fmtTime(m.created_at)}
          name={selectedName || sender}
          replyTo={resolveReply(m.reply_to)}
          onReply={() => onReply(m.wa_msg_id || String(m.id), mediaPreviewLabel(m))}
        >
          {m.revoked ? (
            <Typography sx={{ fontStyle: 'italic', color: WA.meta, fontSize: 13 }}>Pesan ini dihapus</Typography>
          ) : (
            <>
              {m.media_type && !m.from_human && <MediaView agentId={agentId} m={m} token={mediaToken} />}
              {m.image_analysis && (
                <Box
                  sx={{
                    mt: 0.5,
                    p: 0.75,
                    borderRadius: 1,
                    bgcolor: m.image_analysis_status === 'completed' ? alpha(WA.green, 0.08) : alpha('#ed6c02', 0.08),
                    border: '1px solid',
                    borderColor: m.image_analysis_status === 'completed' ? alpha(WA.green, 0.25) : alpha('#ed6c02', 0.25),
                  }}
                >
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.3 }}>
                    <SmartToyIcon sx={{ fontSize: 13, color: WA.greenDark }} />
                    <Typography sx={{ fontSize: 11, fontWeight: 700 }}>Analisis gambar</Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 12, lineHeight: 1.4 }}>{m.image_analysis}</Typography>
                </Box>
              )}
              {(m.media_type === 'image' || m.media_type === 'sticker') && !m.from_human && (
                <Button
                  size="small"
                  startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                  onClick={() => onVision(m)}
                  sx={{ mt: 0.4, px: 0.5, fontSize: 11, color: WA.greenDark }}
                >
                  {m.image_analysis ? 'Analisis ulang' : 'Analisis gambar'}
                </Button>
              )}
              {m.message && <span>{m.message}</span>}
            </>
          )}
        </Bubble>
      )}

      {(m.reply || (m.media_type && m.from_human)) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <Bubble
            side="right"
            tag={m.from_human ? 'CS' : 'Bot'}
            isCS={!!m.from_human}
            time={fmtTime(m.created_at)}
            replyTo={m.reply_text || (m.reply_to ? replyLookup.get(m.reply_to) : '') || undefined}
            onReply={() => onReply(m.wa_msg_id || String(m.id), m.reply || m.message || '📷 Media')}
          >
            {m.revoked ? (
              <Typography sx={{ fontStyle: 'italic', color: WA.meta, fontSize: 13 }}>Pesan ini dihapus</Typography>
            ) : (
              <>
                {m.media_type && m.from_human && <MediaView agentId={agentId} m={m} token={mediaToken} />}
                {m.reply && <span>{m.reply}</span>}
              </>
            )}
          </Bubble>
          {m.from_human && m.wa_msg_id && (
            <IconButton
              size="small"
              onClick={() => onRevoke(m.wa_msg_id || String(m.id))}
              sx={{ p: 0.25, opacity: 0.45, '&:hover': { opacity: 1 } }}
              aria-label="Hapus pesan"
            >
              <DeleteIcon sx={{ fontSize: 14, color: 'error.main' }} />
            </IconButton>
          )}
        </Box>
      )}
    </Box>
  );
});

/* ─── Message thread (memo) — tidak ikut re-render saat mengetik ───────── */

const MessageThread = memo(function MessageThread({
  messages,
  agentId,
  mediaToken,
  selectedName,
  sender,
  replyLookup,
  onReply,
  onRevoke,
  onVision,
  showTyping,
  chatRef,
  bottomRef,
  hasMore,
  totalCount,
  onLoadOlder,
  loadingOlder,
}: {
  messages: ChatMsg[];
  agentId: number;
  mediaToken: string;
  selectedName?: string;
  sender: string;
  replyLookup: Map<string, string>;
  onReply: (id: string, text: string) => void;
  onRevoke: (msgId: string) => void;
  onVision: (m: ChatMsg) => void;
  showTyping: boolean;
  chatRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  hasMore?: boolean;
  totalCount?: number;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
}) {
  return (
    <Box
      ref={chatRef}
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        py: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.35,
        overscrollBehavior: 'contain',
      }}
    >
      {/* Load Older Messages button */}
      {hasMore && onLoadOlder && (
        <Box sx={{ textAlign: 'center', py: 0.5 }}>
          <Button
            size="small"
            variant="text"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            startIcon={loadingOlder ? <CircularProgress size={14} /> : <ExpandMoreIcon />}
            sx={{
              fontSize: 11.5,
              color: WA.greenDark,
              textTransform: 'none',
              borderRadius: 8,
              px: 2,
              '&:hover': { bgcolor: alpha(WA.green, 0.08) },
            }}
          >
            {loadingOlder ? 'Memuat pesan lama…' : `Pesan lama (total ${(totalCount || messages.length).toLocaleString()})`}
          </Button>
        </Box>
      )}
      {messages.map((m) => (
        <MessageBlock
          key={m.id}
          m={m}
          agentId={agentId}
          mediaToken={mediaToken}
          selectedName={selectedName}
          sender={sender}
          replyLookup={replyLookup}
          onReply={onReply}
          onRevoke={onRevoke}
          onVision={onVision}
        />
      ))}
      {showTyping && (
        <Box sx={{ px: { xs: 1, sm: 2.5, md: 4 } }}>
          <TypingIndicator />
        </Box>
      )}
      <div ref={bottomRef} />
    </Box>
  );
});

/* ─── Composer (state teks lokal) — mengetik tidak re-render daftar chat ─ */

const ChatComposer = memo(function ChatComposer({
  agentId,
  sender,
  selectedName,
  replyTo,
  onClearReply,
  busy,
  onSend,
}: {
  agentId: number;
  sender: string;
  selectedName?: string;
  replyTo: { id: string; text: string } | null;
  onClearReply: () => void;
  busy: boolean;
  onSend: (payload: {
    text: string;
    file: File | null;
    replyTo: { id: string; text: string } | null;
  }) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingActive = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const senderRef = useRef(sender);
  senderRef.current = sender;

  // Ganti chat → kosongkan composer, hentikan typing indicator.
  useEffect(() => {
    setText('');
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (typingActive.current) {
      typingActive.current = false;
      void postAgentTyping(agentId, senderRef.current, false);
    }
  }, [sender, agentId]);

  const stopTyping = useCallback(() => {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (typingActive.current) {
      typingActive.current = false;
      void postAgentTyping(agentId, senderRef.current, false);
    }
  }, [agentId]);

  // Presence typing: fire-and-forget, tidak lewat React state/mutation.
  const pulseTyping = useCallback(() => {
    const to = senderRef.current;
    if (!to) return;
    if (!typingActive.current) {
      typingActive.current = true;
      void postAgentTyping(agentId, to, true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      typingActive.current = false;
      void postAgentTyping(agentId, to, false);
    }, 4000);
  }, [agentId]);

  const handleChange = useCallback((value: string) => {
    setText(value);
    pulseTyping();
  }, [pulseTyping]);

  const doSend = useCallback(async () => {
    if (busy || sending) return;
    const payload = {
      text: text.trim(),
      file,
      replyTo,
    };
    if (!payload.file && !payload.text) return;
    stopTyping();
    setSending(true);
    try {
      await onSend(payload);
      setText('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
    } finally {
      setSending(false);
    }
  }, [busy, sending, text, file, replyTo, onSend, stopTyping]);

  const isBusy = busy || sending;
  const canSend = Boolean(file || text.trim()) && !isBusy;

  return (
    <>
      {replyTo && (
        <Stack
          direction="row"
          sx={{
            mx: 1.25,
            mb: 0.5,
            px: 1.25,
            py: 0.75,
            alignItems: 'center',
            gap: 1,
            bgcolor: WA.panel,
            borderRadius: 1,
            borderLeft: `4px solid ${WA.green}`,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: WA.greenDark }}>Membalas</Typography>
            <Typography noWrap sx={{ fontSize: 13, color: WA.meta }}>
              {replyTo.text}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClearReply}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      )}

      {file && (
        <Stack direction="row" sx={{ mx: 1.25, mb: 0.5, alignItems: 'center', gap: 1 }}>
          <Chip
            label={`📎 ${file.name}`}
            size="small"
            onDelete={() => {
              setFile(null);
              if (fileInput.current) fileInput.current.value = '';
            }}
            deleteIcon={<CloseIcon />}
          />
          <Typography sx={{ fontSize: 12, color: WA.meta }}>caption opsional di kolom bawah</Typography>
        </Stack>
      )}

      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          px: 1,
          py: 0.75,
          alignItems: 'flex-end',
          bgcolor: WA.panelHeader,
          flexShrink: 0,
        }}
      >
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <IconButton
          onClick={() => fileInput.current?.click()}
          title="Lampirkan"
          sx={{ color: WA.meta, mb: 0.15 }}
        >
          <AttachFileIcon />
        </IconButton>
        <TemplatePicker
          agentId={agentId}
          variant="text"
          onPick={(b) => {
            const filled = b.replace(/\{nama\}/g, selectedName || 'kak');
            setText((t) => (t ? `${t} ${filled}` : filled));
          }}
        />
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'flex-end',
            bgcolor: WA.panel,
            borderRadius: 3,
            px: 0.5,
            py: 0.25,
            minHeight: 44,
          }}
        >
          <IconButton size="small" sx={{ color: WA.meta, mb: 0.35 }} disabled tabIndex={-1}>
            <InsertEmoticonIcon fontSize="small" />
          </IconButton>
          <TextField
            fullWidth
            multiline
            maxRows={5}
            placeholder={file ? 'Caption (opsional)' : 'Ketik pesan'}
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void doSend();
              }
            }}
            onBlur={stopTyping}
            variant="standard"
            slotProps={{ input: { disableUnderline: true } }}
            sx={{
              '& .MuiInputBase-root': {
                fontSize: 15,
                py: 0.85,
                px: 0.5,
                color: '#111b21',
              },
              '& .MuiInput-underline:before, & .MuiInput-underline:after': { display: 'none' },
            }}
          />
        </Box>
        <IconButton
          onClick={() => void doSend()}
          disabled={!canSend}
          sx={{
            bgcolor: WA.green,
            color: '#fff',
            width: 44,
            height: 44,
            mb: 0.1,
            '&:hover': { bgcolor: WA.greenDark },
            '&.Mui-disabled': { bgcolor: alpha(WA.green, 0.35), color: '#fff' },
          }}
        >
          {isBusy ? <CircularProgress size={20} color="inherit" /> : <SendIcon sx={{ fontSize: 20 }} />}
        </IconButton>
      </Stack>
    </>
  );
});

/* ─── Main panel ────────────────────────────────────────────────────────── */

export default function InboxPanel({
  agentId,
  aiEnabled,
  seed,
}: {
  agentId: number;
  aiEnabled: boolean;
  seed?: { value: string; n: number } | null;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const { data: contacts, isLoading, isFetching } = useContacts(agentId);
  const [sender, setSender] = useState('');
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [search, setSearch] = useState('');

  const { data: convo, isFetching: convoFetching } = useConversation(agentId, sender);
  const loadOlderMsgs = useLoadOlderMessages(agentId, sender);
  const briefQ = useConversationBrief(agentId, sender);
  const refreshBrief = useRefreshConversationBrief(agentId);
  const revokeMsg = useRevokeMessage(agentId);
  const sendMsg = useSendMessage(agentId);
  const sendMedia = useSendMedia(agentId);
  const resumeBot = useResumeBot(agentId);
  const reanalyzeImage = useReanalyzeImage(agentId);
  const deleteConvo = useDeleteInboxConversation(agentId);
  const [deletingSender, setDeletingSender] = useState<string | null>(null);

  const [replyTo, setReplyTo] = useState<{ id: string; text: string } | null>(null);
  const [visionTarget, setVisionTarget] = useState<ChatMsg | null>(null);
  const [visionInstruction, setVisionInstruction] = useState('');
  const [visionError, setVisionError] = useState('');
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const didFirstScroll = useRef(false);

  useEffect(() => {
    if (!sender && contacts?.length) setSender(contacts[0].sender);
  }, [contacts, sender]);

  useEffect(() => {
    if (seed?.value) {
      setSender(seed.value);
      setMobileShowChat(true);
    }
  }, [seed?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    didFirstScroll.current = false;
  }, [sender]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el || !convo) return;
    const t = window.setTimeout(() => {
      if (!el) return;
      if (!didFirstScroll.current) {
        el.scrollTop = el.scrollHeight;
        didFirstScroll.current = true;
      } else {
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }, 40);
    return () => clearTimeout(t);
  }, [convo]);

  const filteredContacts = useMemo(() => {
    const list = contacts || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const num = c.sender.toLowerCase();
      const msg = (c.last_msg || '').toLowerCase();
      return name.includes(q) || num.includes(q) || msg.includes(q);
    });
  }, [contacts, search]);

  const replyLookup = useMemo(() => {
    const map = new Map<string, string>();
    const msgs = convo?.data || [];
    for (const m of msgs) {
      const labelIn = mediaPreviewLabel(m);
      const labelOut = m.reply || labelIn;
      if (m.wa_msg_id) {
        map.set(m.wa_msg_id, m.reply || m.message || labelIn);
      }
      map.set(String(m.id), labelOut || labelIn);
    }
    return map;
  }, [convo?.data]);

  const selectedContact = useMemo(
    () => contacts?.find((ct) => ct.sender === sender),
    [contacts, sender],
  );
  const selectedName = selectedContact?.name;

  const headerSubtitle = useMemo(() => {
    if (convoFetching) return 'memperbarui…';
    if (selectedName) return `+${sender}`;
    return `+${sender}`;
  }, [convoFetching, selectedName, sender]);

  const copyNumber = useCallback(async () => {
    if (!sender) return;
    try {
      await navigator.clipboard.writeText(sender.startsWith('+') ? sender : `+${sender}`);
      setCopyHint('Nomor disalin');
      window.setTimeout(() => setCopyHint(''), 1800);
    } catch {
      setCopyHint('Gagal menyalin');
      window.setTimeout(() => setCopyHint(''), 1800);
    }
  }, [sender]);

  const busy = sendMsg.isPending || sendMedia.isPending;

  const handleLoadOlder = useCallback(() => {
    const msgs = convo?.data;
    if (!msgs || msgs.length === 0) return;
    const oldestId = msgs[0].id;
    loadOlderMsgs.mutate(oldestId);
  }, [convo?.data, loadOlderMsgs]);

  const selectContact = useCallback((s: string) => {
    setSender(s);
    setMobileShowChat(true);
    setReplyTo(null);
  }, []);

  const deleteConversation = useCallback(async (target: string) => {
    const label = contacts?.find((c) => c.sender === target)?.name || `+${target}`;
    const ok = await swalConfirm(
      `Hapus chat ${label}?`,
      'Riwayat percakapan dihapus dari Inbox (termasuk media di server). Data kontak CRM tidak dihapus. Tindakan ini tidak bisa dibatalkan.',
    );
    if (!ok) return;
    setDeletingSender(target);
    try {
      await deleteConvo.mutateAsync(target);
      if (sender === target) {
        setSender('');
        setMobileShowChat(false);
        setContactInfoOpen(false);
        setReplyTo(null);
      }
      swalToast('Chat dihapus dari inbox.');
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      swalToast(msg || 'Gagal menghapus chat.', 'error');
    } finally {
      setDeletingSender(null);
    }
  }, [contacts, deleteConvo, sender]);

  const handleReply = useCallback((id: string, t: string) => {
    setReplyTo({ id, text: t });
  }, []);

  const handleRevoke = useCallback(
    (msgId: string) => {
      if (!sender) return;
      revokeMsg.mutate({ msgId, to: sender });
    },
    [revokeMsg, sender],
  );

  const handleVision = useCallback((m: ChatMsg) => {
    setVisionTarget(m);
    setVisionInstruction('');
    setVisionError('');
  }, []);

  const clearReply = useCallback(() => setReplyTo(null), []);

  const handleComposerSend = useCallback(async (payload: {
    text: string;
    file: File | null;
    replyTo: { id: string; text: string } | null;
  }) => {
    if (!sender) return;
    if (payload.file) {
      await sendMedia.mutateAsync({ to: sender, file: payload.file, caption: payload.text });
      setReplyTo(null);
      return;
    }
    if (!payload.text) return;
    await sendMsg.mutateAsync({
      to: sender,
      message: payload.text,
      reply_to: payload.replyTo?.id || '',
      reply_text: payload.replyTo?.text || '',
    });
    setReplyTo(null);
  }, [sender, sendMedia, sendMsg]);

  const runReanalysis = async () => {
    if (!visionTarget) return;
    setVisionError('');
    try {
      await reanalyzeImage.mutateAsync({ messageId: visionTarget.id, instruction: visionInstruction.trim() });
      setVisionTarget(null);
      setVisionInstruction('');
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setVisionError(msg || 'Analisis ulang belum berhasil.');
    }
  };

  const showList = !isMobile || !mobileShowChat;
  const showChat = !isMobile || mobileShowChat;

  if (isLoading && !contacts) {
    return (
      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', bgcolor: '#f0f2f5' }}>
        <Stack spacing={1.25} sx={{ alignItems: 'center' }}>
          <CircularProgress size={28} sx={{ color: WA.green }} />
          <Typography sx={{ color: WA.meta, fontSize: 13.5 }}>Memuat inbox…</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        bgcolor: '#f0f2f5',
        overflow: 'hidden',
      }}
    >
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      {showList && (
        <Box
          sx={{
            width: { xs: '100%', md: 360 },
            maxWidth: { md: 420 },
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: WA.panel,
            borderRight: { md: `1px solid ${WA.border}` },
            minHeight: 0,
          }}
        >
          <Stack
            direction="row"
            sx={{
              px: 1.5,
              py: 1.1,
              alignItems: 'center',
              justifyContent: 'space-between',
              bgcolor: WA.panelHeader,
              borderBottom: `1px solid ${WA.border}`,
              minHeight: 60,
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: 17, color: '#111b21' }}>Chats</Typography>
            <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
              {isFetching && <CircularProgress size={12} sx={{ color: WA.meta, mr: 0.5 }} thickness={5} />}
              <IconButton size="small" sx={{ color: WA.meta }} aria-label="Menu">
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>

          <Box sx={{ px: 1.25, py: 0.75, bgcolor: WA.panel }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Cari atau mulai chat baru"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 18, color: WA.meta }} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: WA.searchBg,
                  borderRadius: 2,
                  fontSize: 14,
                  '& fieldset': { border: 'none' },
                },
              }}
            />
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {filteredContacts.length === 0 ? (
              <Typography sx={{ p: 3, color: WA.meta, fontSize: 14, textAlign: 'center' }}>
                {search ? 'Tidak ada chat yang cocok.' : 'Belum ada percakapan.'}
              </Typography>
            ) : (
              filteredContacts.map((ct) => (
                <ContactRow
                  key={ct.sender}
                  ct={ct}
                  selected={ct.sender === sender && (!isMobile || mobileShowChat)}
                  onSelect={selectContact}
                  onDelete={(s) => { void deleteConversation(s); }}
                  deleting={deletingSender === ct.sender}
                />
              ))
            )}
          </Box>
        </Box>
      )}

      {/* ── Chat pane ─────────────────────────────────────────────────── */}
      {showChat && (
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: WA.chatBg,
            // Subtle WA wallpaper noise via layered gradient
            backgroundImage: `
              linear-gradient(${alpha('#d1d7db', 0.35)}, ${alpha('#d1d7db', 0.35)}),
              url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c5bbb0' fill-opacity='0.18'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")
            `,
          }}
        >
          {!sender ? (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#f0f2f5',
                borderBottom: { md: '6px solid #00a884' },
                px: 3,
                textAlign: 'center',
              }}
            >
              <Box
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  bgcolor: alpha(WA.green, 0.12),
                  display: 'grid',
                  placeItems: 'center',
                  mb: 2,
                }}
              >
                <SmartToyIcon sx={{ fontSize: 36, color: WA.greenDark }} />
              </Box>
              <Typography sx={{ fontWeight: 300, fontSize: 28, color: '#41525d', mb: 1 }}>
                SlaluDiskon Inbox
              </Typography>
              <Typography sx={{ maxWidth: 420, color: WA.meta, fontSize: 14, lineHeight: 1.5 }}>
                Pilih percakapan di kiri untuk membalas pelanggan. Chat AI, CS, dan pelanggan digabung dalam satu thread.
              </Typography>
            </Box>
          ) : (
            <>
              {/* Header — area nama/avatar bisa dibuka untuk info kontak */}
              <Stack
                direction="row"
                sx={{
                  px: 1.25,
                  py: 0.75,
                  alignItems: 'center',
                  gap: 1,
                  bgcolor: WA.panelHeader,
                  borderBottom: `1px solid ${WA.border}`,
                  minHeight: 60,
                  flexShrink: 0,
                }}
              >
                {isMobile && (
                  <IconButton size="small" onClick={() => setMobileShowChat(false)} aria-label="Kembali">
                    <ArrowBackIcon />
                  </IconButton>
                )}
                <Box
                  component="button"
                  type="button"
                  onClick={() => setContactInfoOpen(true)}
                  aria-label="Buka info kontak"
                  sx={{
                    appearance: 'none',
                    border: 0,
                    bgcolor: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    flex: 1,
                    minWidth: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderRadius: 1,
                    py: 0.25,
                    px: 0.25,
                    '&:hover': { bgcolor: alpha('#000', 0.04) },
                  }}
                >
                  <Avatar
                    sx={{
                      width: 40,
                      height: 40,
                      fontSize: 16,
                      fontWeight: 600,
                      bgcolor: avatarColor(sender),
                      color: '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {(selectedName || sender).charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 600, fontSize: 16, color: '#111b21', lineHeight: 1.25 }}>
                      {selectedName || `+${sender}`}
                    </Typography>
                    <Typography noWrap sx={{ fontSize: 12.5, color: WA.meta, lineHeight: 1.2 }}>
                      {headerSubtitle}
                    </Typography>
                  </Box>
                </Box>
                <Tooltip title="Info kontak">
                  <IconButton size="small" onClick={() => setContactInfoOpen(true)} aria-label="Info kontak" sx={{ color: WA.meta }}>
                    <InfoOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {convo?.needs_human ? (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<TaskAltIcon />}
                    onClick={() => resumeBot.mutate(sender)}
                    disabled={resumeBot.isPending}
                    sx={{ bgcolor: WA.green, '&:hover': { bgcolor: WA.greenDark }, textTransform: 'none', boxShadow: 'none' }}
                  >
                    Selesai
                  </Button>
                ) : convo?.manual_pause_until && new Date(convo.manual_pause_until).getTime() > Date.now() ? (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Chip
                      size="small"
                      label={`AI off · ${fmtTime(convo.manual_pause_until)}`}
                      sx={{ height: 24, fontSize: 11, bgcolor: alpha('#53bdeb', 0.12) }}
                    />
                    <Button size="small" onClick={() => resumeBot.mutate(sender)} disabled={resumeBot.isPending} sx={{ textTransform: 'none' }}>
                      Aktifkan AI
                    </Button>
                  </Stack>
                ) : (
                  <Chip
                    size="small"
                    label={aiEnabled ? 'AI aktif' : 'AI nonaktif'}
                    sx={{
                      height: 24,
                      fontSize: 11,
                      fontWeight: 600,
                      bgcolor: aiEnabled ? alpha(WA.green, 0.12) : alpha('#000', 0.06),
                      color: aiEnabled ? WA.greenDark : WA.meta,
                    }}
                  />
                )}
              </Stack>

              <ConversationBriefBar
                brief={briefQ.data}
                loading={briefQ.isLoading}
                refreshing={refreshBrief.isPending}
                onRefresh={() => sender && refreshBrief.mutate(sender)}
                error={
                  (briefQ.error as { response?: { data?: { error?: string } } })?.response?.data?.error
                  || (briefQ.isError ? 'Gagal memuat ringkasan' : undefined)
                }
              />

              <MessageThread
                messages={convo?.data || []}
                agentId={agentId}
                mediaToken={convo?.media_token || ''}
                selectedName={selectedName}
                sender={sender}
                replyLookup={replyLookup}
                onReply={handleReply}
                onRevoke={handleRevoke}
                onVision={handleVision}
                showTyping={busy}
                chatRef={chatRef}
                bottomRef={bottomRef}
                hasMore={convo?.has_more}
                totalCount={convo?.total}
                onLoadOlder={handleLoadOlder}
                loadingOlder={loadOlderMsgs.isPending}
              />

              <ChatComposer
                agentId={agentId}
                sender={sender}
                selectedName={selectedName}
                replyTo={replyTo}
                onClearReply={clearReply}
                busy={busy}
                onSend={handleComposerSend}
              />
            </>
          )}
        </Box>
      )}

      {/* Panel info kontak — dibuka dari header chat */}
      <Drawer
        anchor="right"
        open={contactInfoOpen && !!sender}
        onClose={() => setContactInfoOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100%', sm: 360 },
              bgcolor: '#f0f2f5',
            },
          },
        }}
      >
        <Stack
          direction="row"
          sx={{
            px: 1,
            py: 0.75,
            alignItems: 'center',
            gap: 0.5,
            bgcolor: WA.greenDark,
            color: '#fff',
            minHeight: 56,
          }}
        >
          <IconButton size="small" onClick={() => setContactInfoOpen(false)} sx={{ color: '#fff' }} aria-label="Tutup">
            <CloseIcon />
          </IconButton>
          <Typography sx={{ fontWeight: 600, fontSize: 16 }}>Info kontak</Typography>
        </Stack>

        <Box sx={{ bgcolor: WA.panel, pt: 3, pb: 2.5, px: 2, textAlign: 'center', borderBottom: `1px solid ${WA.border}` }}>
          <Avatar
            sx={{
              width: 120,
              height: 120,
              fontSize: 48,
              fontWeight: 600,
              bgcolor: avatarColor(sender),
              color: '#fff',
              mx: 'auto',
              mb: 1.5,
            }}
          >
            {(selectedName || sender).charAt(0).toUpperCase()}
          </Avatar>
          <Typography sx={{ fontWeight: 500, fontSize: 22, color: '#111b21', lineHeight: 1.25 }}>
            {selectedName || `+${sender}`}
          </Typography>
          <Typography sx={{ fontSize: 15, color: WA.meta, mt: 0.35 }}>
            +{sender.replace(/^\+/, '')}
          </Typography>
        </Box>

        <Box sx={{ bgcolor: WA.panel, mt: 1.25, px: 2, py: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: WA.greenDark, mb: 1 }}>Tentang</Typography>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <PhoneOutlinedIcon sx={{ fontSize: 20, color: WA.meta }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 15, color: '#111b21' }}>+{sender.replace(/^\+/, '')}</Typography>
                <Typography sx={{ fontSize: 12.5, color: WA.meta }}>WhatsApp</Typography>
              </Box>
              <Tooltip title="Salin nomor">
                <IconButton size="small" onClick={() => void copyNumber()} aria-label="Salin nomor">
                  <ContentCopyIcon sx={{ fontSize: 18, color: WA.meta }} />
                </IconButton>
              </Tooltip>
            </Stack>
            {copyHint && (
              <Typography sx={{ fontSize: 12, color: WA.greenDark, pl: 4.5 }}>{copyHint}</Typography>
            )}
          </Stack>
        </Box>

        <Box sx={{ bgcolor: WA.panel, mt: 1.25, px: 2, py: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: WA.greenDark, mb: 1 }}>Status chat</Typography>
          <Stack spacing={0.85}>
            <InfoRow
              label="Penanganan CS"
              value={convo?.needs_human ? 'Butuh penanganan' : 'Tidak dalam antrian'}
            />
            <InfoRow
              label="Asisten AI"
              value={
                convo?.manual_pause_until && new Date(convo.manual_pause_until).getTime() > Date.now()
                  ? `Dijeda sampai ${fmtTime(convo.manual_pause_until)}`
                  : aiEnabled
                    ? 'Dapat membalas'
                    : 'Nonaktif di agent'
              }
            />
            <InfoRow
              label="Pesan di thread"
              value={convo?.total ? `${convo.data?.length || 0} dimuat dari ${convo.total} total pesan` : convo?.data ? `${convo.data.length} pesan` : '—'}
            />
            <InfoRow
              label="Aktivitas terakhir"
              value={
                selectedContact?.last_at
                  ? new Date(selectedContact.last_at).toLocaleString('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'
              }
            />
            {selectedContact?.last_msg && (
              <Box>
                <Typography sx={{ fontSize: 12.5, color: WA.meta, mb: 0.25 }}>Pesan terakhir</Typography>
                <Typography sx={{ fontSize: 14, color: '#111b21', lineHeight: 1.4 }}>
                  {selectedContact.last_msg}
                </Typography>
              </Box>
            )}
          </Stack>
        </Box>

        {briefQ.data && (
          <Box sx={{ bgcolor: WA.panel, mt: 1.25, px: 2, py: 1.5, mb: 2 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: WA.greenDark, mb: 1 }}>Ringkasan AI</Typography>
            <Stack spacing={0.75}>
              {briefQ.data.intent && <InfoRow label="Intent" value={briefQ.data.intent} />}
              {briefQ.data.stage && (
                <InfoRow label="Tahap" value={STAGE_LABEL[briefQ.data.stage] || briefQ.data.stage} />
              )}
              {briefQ.data.summary && (
                <Typography sx={{ fontSize: 13.5, color: '#3b4a54', lineHeight: 1.45 }}>
                  {briefQ.data.summary}
                </Typography>
              )}
            </Stack>
          </Box>
        )}

        <Box sx={{ px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {convo?.needs_human && (
            <Button
              fullWidth
              variant="contained"
              startIcon={<TaskAltIcon />}
              onClick={() => {
                resumeBot.mutate(sender);
                setContactInfoOpen(false);
              }}
              disabled={resumeBot.isPending}
              sx={{ bgcolor: WA.green, '&:hover': { bgcolor: WA.greenDark }, textTransform: 'none', boxShadow: 'none' }}
            >
              Selesaikan penanganan
            </Button>
          )}
          <Button
            fullWidth
            color="error"
            variant="outlined"
            startIcon={deleteConvo.isPending ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
            onClick={() => { void deleteConversation(sender); }}
            disabled={deleteConvo.isPending || deletingSender === sender}
            sx={{ textTransform: 'none' }}
          >
            Hapus chat dari inbox
          </Button>
          <Typography sx={{ fontSize: 11.5, color: WA.meta, lineHeight: 1.4, textAlign: 'center' }}>
            Menghapus riwayat di Inbox saja. Kontak CRM dan chat di HP pelanggan tidak terpengaruh.
          </Typography>
        </Box>
      </Drawer>

      <Dialog open={!!visionTarget} onClose={() => !reanalyzeImage.isPending && setVisionTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Analisis ulang gambar</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Kosongkan instruksi untuk analisis umum, atau jelaskan detail yang perlu diperiksa. Hasil baru menggantikan
            analisis lama tanpa mengirim pesan ke pelanggan.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            autoFocus
            label="Instruksi khusus (opsional)"
            placeholder="Contoh: Baca warna dan ukuran yang terlihat, lalu cocokkan dengan katalog produk."
            value={visionInstruction}
            onChange={(event) => setVisionInstruction(event.target.value.slice(0, 800))}
            helperText={`${visionInstruction.length}/800`}
          />
          {visionError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {visionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVisionTarget(null)} disabled={reanalyzeImage.isPending}>
            Batal
          </Button>
          <Button
            variant="contained"
            startIcon={
              reanalyzeImage.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />
            }
            onClick={() => void runReanalysis()}
            disabled={reanalyzeImage.isPending}
          >
            Analisis sekarang
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
