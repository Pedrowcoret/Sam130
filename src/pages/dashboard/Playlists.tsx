import React, { useState, useEffect } from 'react';
import { ChevronLeft, Play, Trash2, Edit2, Save, X, Plus, Video, Clock, Users, Shuffle, List, Calendar, AlertCircle, CheckCircle, RefreshCw, Eye, Settings, Radio } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import IFrameVideoPlayer from '../../components/IFrameVideoPlayer';

interface Playlist {
  id: number;
  nome: string;
  data_criacao: string;
  total_videos: number;
  duracao_total: number;
  comerciais?: 'sim' | 'nao';
  status_transmissao?: 'ativa' | 'inativa' | 'pausada';
}

interface Video {
  id: number;
  nome: string;
  url: string;
  caminho: string;
  duracao: number;
  duracao_segundos: number;
  tamanho_arquivo: number;
  bitrate_video: number;
  formato_original: string;
  largura: number;
  altura: number;
  ordem_playlist?: number;
  tipo?: 'video' | 'comercial';
  path_video?: string;
  thumb?: string;
}

interface Folder {
  id: number;
  nome: string;
  nome_sanitizado: string;
  video_count_db: number;
}

interface ComercialConfig {
  id?: number;
  codigo_playlist: number;
  pasta_comerciais: string;
  quantidade_comerciais: number;
  intervalo_videos: number;
  ativo: boolean;
}

interface PlaylistVideo {
  videos: Video;
}

interface TransmissionStatus {
  is_live: boolean;
  stream_type?: 'playlist' | 'obs';
  transmission?: {
    id: number;
    titulo: string;
    codigo_playlist: number;
    wowza_stream_id: string;
    use_smil: boolean;
    stats: {
      viewers: number;
      bitrate: number;
      uptime: string;
      isActive: boolean;
    };
  };
}

function SortableVideoItem({ video, onRemove }: { video: Video; onRemove: (id: number) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const getVideoIcon = () => {
    if (video.tipo === 'comercial') {
      return <div className="w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center">
        <span className="text-xs text-white font-bold">C</span>
      </div>;
    }
    return <Video className="h-4 w-4 text-blue-600" />;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-3 border rounded-lg ${
        isDragging ? 'shadow-lg bg-blue-50' : 'bg-white border-gray-200'
      } ${video.tipo === 'comercial' ? 'border-yellow-300 bg-yellow-50' : ''}`}
    >
      <div className="flex items-center space-x-3 flex-1">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab hover:cursor-grabbing text-gray-400 hover:text-gray-600"
        >
          <div className="flex flex-col items-center">
            <div className="w-6 h-1 bg-gray-300 rounded mb-1"></div>
            <div className="w-6 h-1 bg-gray-300 rounded"></div>
          </div>
        </div>
        
        {getVideoIcon()}
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h4 className="font-medium text-gray-900 truncate">{video.nome}</h4>
            {video.tipo === 'comercial' && (
              <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-1 rounded">
                Comercial
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4 text-sm text-gray-500">
            <span className="flex items-center">
              <Clock className="h-3 w-3 mr-1" />
              {formatDuration(video.duracao_segundos || video.duracao || 0)}
            </span>
            {video.tamanho_arquivo && (
              <span>{formatFileSize(video.tamanho_arquivo)}</span>
            )}
            {video.bitrate_video && (
              <span>{video.bitrate_video} kbps</span>
            )}
            <span className="text-xs text-gray-400">
              {video.formato_original?.toUpperCase() || 'MP4'}
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={() => onRemove(video.id)}
        className="text-red-600 hover:text-red-800 p-1"
        title="Remover da playlist"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

const Playlists: React.FC = () => {
  const { getToken, user } = useAuth();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistVideos, setPlaylistVideos] = useState<Video[]>([]);
  const [availableVideos, setAvailableVideos] = useState<Video[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showNewPlaylistModal, setShowNewPlaylistModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showComercialModal, setShowComercialModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [editPlaylistName, setEditPlaylistName] = useState('');
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [transmissionStatus, setTransmissionStatus] = useState<TransmissionStatus | null>(null);
  const [comercialConfig, setComercialConfig] = useState<ComercialConfig>({
    codigo_playlist: 0,
    pasta_comerciais: '',
    quantidade_comerciais: 1,
    intervalo_videos: 10,
    ativo: true
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    loadPlaylists();
    loadFolders();
    checkTransmissionStatus();
  }, []);

  useEffect(() => {
    if (selectedPlaylist) {
      loadPlaylistVideos(selectedPlaylist.id);
    }
  }, [selectedPlaylist]);

  useEffect(() => {
    if (selectedFolder) {
      loadVideosFromFolder(selectedFolder);
    }
  }, [selectedFolder]);

  const checkTransmissionStatus = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/streaming/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setTransmissionStatus(data);
      }
    } catch (error) {
      console.error('Erro ao verificar status de transmissão:', error);
    }
  };

  const loadPlaylists = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/playlists', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setPlaylists(data);
      
      if (data.length > 0 && !selectedPlaylist) {
        setSelectedPlaylist(data[0]);
      }
    } catch (error) {
      toast.error('Erro ao carregar playlists');
    }
  };

  const loadFolders = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/folders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setFolders(data);
      
      if (data.length > 0 && !selectedFolder) {
        setSelectedFolder(data[0].id.toString());
      }
    } catch (error) {
      toast.error('Erro ao carregar pastas');
    }
  };

  const loadPlaylistVideos = async (playlistId: number) => {
    try {
      const token = await getToken();
      const response = await fetch(`/api/playlists/${playlistId}/videos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data: PlaylistVideo[] = await response.json();
      
      // Extrair vídeos do formato retornado pela API
      const videos = data.map(item => item.videos).sort((a, b) => (a.ordem_playlist || 0) - (b.ordem_playlist || 0));
      setPlaylistVideos(videos);
    } catch (error) {
      console.error('Erro ao carregar vídeos da playlist:', error);
      setPlaylistVideos([]);
    }
  };

  const loadVideosFromFolder = async (folderId: string) => {
    try {
      const token = await getToken();
      const response = await fetch(`/api/videos?folder_id=${folderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setAvailableVideos(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Erro ao carregar vídeos da pasta:', error);
      setAvailableVideos([]);
    }
  };

  const createPlaylist = async () => {
    if (!newPlaylistName.trim()) {
      toast.error('Nome da playlist é obrigatório');
      return;
    }

    try {
      const token = await getToken();
      const response = await fetch('/api/playlists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ nome: newPlaylistName.trim() })
      });

      if (response.ok) {
        const newPlaylist = await response.json();
        toast.success('Playlist criada com sucesso!');
        setShowNewPlaylistModal(false);
        setNewPlaylistName('');
        loadPlaylists();
        
        // Selecionar a nova playlist
        const createdPlaylist = { 
          id: newPlaylist.id, 
          nome: newPlaylistName.trim(),
          data_criacao: new Date().toISOString(),
          total_videos: 0,
          duracao_total: 0
        };
        setSelectedPlaylist(createdPlaylist);
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao criar playlist');
      }
    } catch (error) {
      console.error('Erro ao criar playlist:', error);
      toast.error('Erro ao criar playlist');
    }
  };

  const updatePlaylist = async () => {
    if (!editingPlaylist || !editPlaylistName.trim()) {
      toast.error('Nome da playlist é obrigatório');
      return;
    }

    try {
      const token = await getToken();
      const response = await fetch(`/api/playlists/${editingPlaylist.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          nome: editPlaylistName.trim(),
          videos: playlistVideos.map((video, index) => ({
            id: video.id,
            ordem: index
          }))
        })
      });

      if (response.ok) {
        toast.success('Playlist atualizada com sucesso!');
        setShowEditModal(false);
        setEditingPlaylist(null);
        setEditPlaylistName('');
        loadPlaylists();
        
        // Atualizar playlist selecionada
        if (selectedPlaylist?.id === editingPlaylist.id) {
          setSelectedPlaylist(prev => prev ? { ...prev, nome: editPlaylistName.trim() } : null);
        }
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao atualizar playlist');
      }
    } catch (error) {
      console.error('Erro ao atualizar playlist:', error);
      toast.error('Erro ao atualizar playlist');
    }
  };

  const deletePlaylist = async (playlist: Playlist) => {
    // Verificar se playlist está em transmissão
    if (transmissionStatus?.is_live && 
        transmissionStatus.stream_type === 'playlist' && 
        transmissionStatus.transmission?.codigo_playlist === playlist.id) {
      toast.error('Não é possível excluir playlist em transmissão. Finalize a transmissão primeiro.');
      return;
    }

    if (!confirm(`Deseja realmente excluir a playlist "${playlist.nome}"?`)) return;

    try {
      const token = await getToken();
      const response = await fetch(`/api/playlists/${playlist.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Playlist excluída com sucesso!');
        loadPlaylists();
        
        if (selectedPlaylist?.id === playlist.id) {
          setSelectedPlaylist(null);
          setPlaylistVideos([]);
        }
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao excluir playlist');
      }
    } catch (error) {
      console.error('Erro ao excluir playlist:', error);
      toast.error('Erro ao excluir playlist');
    }
  };

  const addVideoToPlaylist = (video: Video) => {
    // Verificar se vídeo já está na playlist
    if (playlistVideos.find(v => v.id === video.id)) {
      toast.warning('Vídeo já está na playlist');
      return;
    }

    const newVideo = {
      ...video,
      ordem_playlist: playlistVideos.length,
      tipo: 'video' as const
    };

    setPlaylistVideos(prev => [...prev, newVideo]);
    toast.success(`Vídeo "${video.nome}" adicionado à playlist`);
  };

  const removeVideoFromPlaylist = (videoId: number) => {
    setPlaylistVideos(prev => prev.filter(v => v.id !== videoId));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setPlaylistVideos(prev => {
        const oldIndex = prev.findIndex(video => video.id === active.id);
        const newIndex = prev.findIndex(video => video.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const shuffleVideos = () => {
    setPlaylistVideos(prev => {
      const shuffled = [...prev];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    });
    toast.success('Vídeos embaralhados!');
  };

  const savePlaylist = async () => {
    if (!selectedPlaylist) {
      toast.error('Selecione uma playlist');
      return;
    }

    if (playlistVideos.length === 0) {
      toast.error('Adicione pelo menos um vídeo à playlist');
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`/api/playlists/${selectedPlaylist.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          videos: playlistVideos.map((video, index) => ({
            id: video.id,
            ordem: index
          }))
        })
      });

      if (response.ok) {
        toast.success('Playlist salva com sucesso!');
        loadPlaylists();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao salvar playlist');
      }
    } catch (error) {
      console.error('Erro ao salvar playlist:', error);
      toast.error('Erro ao salvar playlist');
    } finally {
      setLoading(false);
    }
  };

  const saveAndStartPlaylist = async () => {
    if (!selectedPlaylist) {
      toast.error('Selecione uma playlist');
      return;
    }

    if (playlistVideos.length === 0) {
      toast.error('Adicione pelo menos um vídeo à playlist');
      return;
    }

    // Verificar se já há transmissão ativa
    if (transmissionStatus?.is_live) {
      toast.error('Já existe uma transmissão ativa. Finalize-a antes de iniciar uma nova.');
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      
      // Primeiro salvar a playlist
      await fetch(`/api/playlists/${selectedPlaylist.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          videos: playlistVideos.map((video, index) => ({
            id: video.id,
            ordem: index
          }))
        })
      });

      // Depois iniciar transmissão
      const transmissionResponse = await fetch('/api/streaming/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          titulo: `Transmissão: ${selectedPlaylist.nome}`,
          descricao: `Playlist ${selectedPlaylist.nome} com ${playlistVideos.length} vídeos`,
          playlist_id: selectedPlaylist.id,
          platform_ids: [], // Sem plataformas por padrão
          use_smil: true,
          enable_recording: false
        })
      });

      const transmissionResult = await transmissionResponse.json();

      if (transmissionResult.success) {
        toast.success('Playlist salva e transmissão iniciada!');
        checkTransmissionStatus();
        
        // Redirecionar para página de transmissão
        navigate('/dashboard/iniciar-transmissao');
      } else {
        toast.error(transmissionResult.error || 'Erro ao iniciar transmissão');
      }
    } catch (error) {
      console.error('Erro ao salvar e iniciar playlist:', error);
      toast.error('Erro ao salvar e iniciar playlist');
    } finally {
      setLoading(false);
    }
  };

  const addComercials = async () => {
    if (!selectedPlaylist || !comercialConfig.pasta_comerciais) {
      toast.error('Selecione uma playlist e uma pasta de comerciais');
      return;
    }

    try {
      const token = await getToken();
      
      // Buscar vídeos da pasta de comerciais
      const comercialFolder = folders.find(f => f.nome_sanitizado === comercialConfig.pasta_comerciais);
      if (!comercialFolder) {
        toast.error('Pasta de comerciais não encontrada');
        return;
      }

      const response = await fetch(`/api/videos?folder_id=${comercialFolder.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const comercialVideos = await response.json();

      if (!Array.isArray(comercialVideos) || comercialVideos.length === 0) {
        toast.error('Nenhum vídeo encontrado na pasta de comerciais');
        return;
      }

      // Aplicar lógica de inserção de comerciais baseada no código PHP
      const videosComComerciais = insertComercials(playlistVideos, comercialVideos, comercialConfig);
      setPlaylistVideos(videosComComerciais);
      
      toast.success(`${comercialVideos.length} comerciais inseridos na playlist!`);
      setShowComercialModal(false);
    } catch (error) {
      console.error('Erro ao adicionar comerciais:', error);
      toast.error('Erro ao adicionar comerciais');
    }
  };

  // Função para inserir comerciais baseada na lógica do PHP
  const insertComercials = (videos: Video[], comerciais: Video[], config: ComercialConfig): Video[] => {
    const result: Video[] = [];
    let comercialIndex = 0;
    let videoCount = 0;

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      
      // Adicionar vídeo normal
      if (video.tipo !== 'comercial') {
        result.push({ ...video, ordem_playlist: result.length });
        videoCount++;

        // Verificar se deve inserir comerciais
        if (videoCount === config.intervalo_videos && comerciais.length > 0) {
          // Inserir quantidade especificada de comerciais
          for (let j = 0; j < config.quantidade_comerciais; j++) {
            if (comercialIndex >= comerciais.length) {
              comercialIndex = 0; // Reiniciar ciclo de comerciais
            }

            const comercial = comerciais[comercialIndex];
            result.push({
              ...comercial,
              id: comercial.id + 10000 + j, // ID único para comerciais
              tipo: 'comercial',
              ordem_playlist: result.length
            });

            comercialIndex++;
          }
          
          videoCount = 0; // Resetar contador
        }
      }
    }

    return result;
  };

  const openVideoPlayer = (video: Video) => {
    setCurrentVideo(video);
    setShowVideoModal(true);
  };

  const closeVideoPlayer = () => {
    setShowVideoModal(false);
    setCurrentVideo(null);
  };

  const buildVideoUrl = (video: Video) => {
    if (!video.url) return '';

    // Para vídeos da playlist, construir URL do player na porta do sistema
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'http://samhost.wcore.com.br:3001'
      : 'http://localhost:3001';

    // Se é um vídeo de playlist em transmissão, usar URL de playlist
    if (transmissionStatus?.is_live && 
        transmissionStatus.stream_type === 'playlist' && 
        transmissionStatus.transmission?.codigo_playlist === selectedPlaylist?.id) {
      
      const userLogin = user?.usuario || (user?.email ? user.email.split('@')[0] : `user_${user?.id}`);
      return `${baseUrl}/api/player-port/iframe?playlist=${selectedPlaylist.id}&login=${userLogin}&player=1&contador=true`;
    }

    // Para vídeos individuais, usar URL do vídeo específico
    const cleanPath = video.url.replace(/^\/+/, '').replace(/^(content\/|streaming\/)?/, '');
    const pathParts = cleanPath.split('/');
    
    if (pathParts.length >= 3) {
      const userLogin = pathParts[0];
      const folderName = pathParts[1];
      const fileName = pathParts[2];
      const finalFileName = fileName.endsWith('.mp4') ? fileName : fileName.replace(/\.[^/.]+$/, '.mp4');
      
      return `${baseUrl}/api/player-port/iframe?login=${userLogin}&vod=${folderName}/${finalFileName}&player=1`;
    }

    return '';
  };

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getTotalDuration = () => {
    return playlistVideos.reduce((total, video) => total + (video.duracao_segundos || video.duracao || 0), 0);
  };

  const getPlaylistStatus = (playlist: Playlist) => {
    if (transmissionStatus?.is_live && 
        transmissionStatus.stream_type === 'playlist' && 
        transmissionStatus.transmission?.codigo_playlist === playlist.id) {
      return 'ativa';
    }
    return 'inativa';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ativa': return 'bg-red-100 text-red-800';
      case 'pausada': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ativa': return 'AO VIVO';
      case 'pausada': return 'PAUSADA';
      default: return 'OFFLINE';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <Link to="/dashboard" className="flex items-center text-primary-600 hover:text-primary-800">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span>Voltar ao Dashboard</span>
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <List className="h-8 w-8 text-primary-600" />
          <h1 className="text-3xl font-bold text-gray-900">Gerenciar Playlists</h1>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={checkTransmissionStatus}
            className="text-primary-600 hover:text-primary-800 flex items-center text-sm"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Atualizar Status
          </button>
          <button
            onClick={() => setShowNewPlaylistModal(true)}
            className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 flex items-center"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nova Playlist
          </button>
        </div>
      </div>

      {/* Status de Transmissão */}
      {transmissionStatus?.is_live && transmissionStatus.stream_type === 'playlist' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse mr-3"></div>
              <div>
                <h2 className="text-lg font-semibold text-red-800">PLAYLIST EM TRANSMISSÃO</h2>
                <p className="text-red-600 text-sm">
                  Playlist ID: {transmissionStatus.transmission?.codigo_playlist} • 
                  Espectadores: {transmissionStatus.transmission?.stats.viewers || 0} • 
                  Tempo: {transmissionStatus.transmission?.stats.uptime || '00:00:00'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const userLogin = user?.usuario || (user?.email ? user.email.split('@')[0] : `user_${user?.id}`);
                  const baseUrl = process.env.NODE_ENV === 'production' 
                    ? 'http://samhost.wcore.com.br:3001'
                    : 'http://localhost:3001';
                  const playerUrl = `${baseUrl}/api/player-port/iframe?playlist=${transmissionStatus.transmission?.codigo_playlist}&login=${userLogin}&player=1&contador=true`;
                  window.open(playerUrl, '_blank');
                }}
                className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 flex items-center text-sm"
              >
                <Eye className="h-4 w-4 mr-1" />
                Visualizar
              </button>
              <button
                onClick={() => navigate('/dashboard/iniciar-transmissao')}
                className="bg-red-600 text-white px-3 py-2 rounded-md hover:bg-red-700 flex items-center text-sm"
              >
                <Settings className="h-4 w-4 mr-1" />
                Gerenciar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de Playlists */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Playlists</h2>
          
          {playlists.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <List className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>Nenhuma playlist criada</p>
            </div>
          ) : (
            <div className="space-y-3">
              {playlists.map((playlist) => {
                const status = getPlaylistStatus(playlist);
                return (
                  <div
                    key={playlist.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      selectedPlaylist?.id === playlist.id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedPlaylist(playlist)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-gray-900 truncate">{playlist.nome}</h3>
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(status)}`}>
                          {getStatusText(status)}
                        </span>
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPlaylist(playlist);
                              setEditPlaylistName(playlist.nome);
                              setShowEditModal(true);
                            }}
                            className="text-blue-600 hover:text-blue-800 p-1"
                            title="Editar playlist"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePlaylist(playlist);
                            }}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Excluir playlist"
                            disabled={status === 'ativa'}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span className="flex items-center">
                        <Video className="h-3 w-3 mr-1" />
                        {playlist.total_videos || 0} vídeos
                      </span>
                      <span className="flex items-center">
                        <Clock className="h-3 w-3 mr-1" />
                        {formatDuration(playlist.duracao_total || 0)}
                      </span>
                    </div>
                    
                    {playlist.comerciais === 'sim' && (
                      <div className="mt-2">
                        <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-1 rounded">
                          Com Comerciais
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Vídeos Disponíveis */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">Vídeos Disponíveis</h2>
            <button
              onClick={() => setShowComercialModal(true)}
              disabled={!selectedPlaylist}
              className="bg-yellow-600 text-white px-3 py-2 rounded-md hover:bg-yellow-700 disabled:opacity-50 flex items-center text-sm"
            >
              <Plus className="h-3 w-3 mr-1" />
              Comerciais
            </button>
          </div>
          
          <div className="mb-4">
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Selecione uma pasta</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.nome} ({folder.video_count_db || 0} vídeos)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {availableVideos.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Video className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>Nenhum vídeo encontrado</p>
                {selectedFolder && (
                  <p className="text-sm">Selecione outra pasta</p>
                )}
              </div>
            ) : (
              availableVideos.map((video) => (
                <div
                  key={video.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <Video className="h-4 w-4 text-blue-600" />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-900 truncate">{video.nome}</h4>
                      <div className="flex items-center space-x-2 text-sm text-gray-500">
                        <span>{formatDuration(video.duracao || 0)}</span>
                        {video.bitrate_video && <span>{video.bitrate_video} kbps</span>}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => openVideoPlayer(video)}
                      className="text-green-600 hover:text-green-800 p-1"
                      title="Reproduzir vídeo"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => addVideoToPlaylist(video)}
                      disabled={!selectedPlaylist}
                      className="text-primary-600 hover:text-primary-800 p-1 disabled:opacity-50"
                      title="Adicionar à playlist"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Playlist Selecionada */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">
                {selectedPlaylist ? selectedPlaylist.nome : 'Selecione uma Playlist'}
              </h2>
              {selectedPlaylist && (
                <div className="flex items-center space-x-4 text-sm text-gray-500 mt-1">
                  <span className="flex items-center">
                    <Video className="h-3 w-3 mr-1" />
                    {playlistVideos.length} vídeos
                  </span>
                  <span className="flex items-center">
                    <Clock className="h-3 w-3 mr-1" />
                    {formatDuration(getTotalDuration())}
                  </span>
                </div>
              )}
            </div>
            
            {selectedPlaylist && playlistVideos.length > 0 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={shuffleVideos}
                  className="text-purple-600 hover:text-purple-800 p-2"
                  title="Embaralhar vídeos"
                >
                  <Shuffle className="h-4 w-4" />
                </button>
                <button
                  onClick={() => navigate(`/dashboard/agendamentos?playlist=${selectedPlaylist.id}`)}
                  className="text-blue-600 hover:text-blue-800 p-2"
                  title="Agendar playlist"
                >
                  <Calendar className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {!selectedPlaylist ? (
            <div className="text-center py-12 text-gray-500">
              <List className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p>Selecione uma playlist para gerenciar</p>
            </div>
          ) : playlistVideos.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Video className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p>Playlist vazia</p>
              <p className="text-sm">Adicione vídeos da lista ao lado</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={playlistVideos.map(video => video.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {playlistVideos.map((video) => (
                    <SortableVideoItem
                      key={video.id}
                      video={video}
                      onRemove={removeVideoFromPlaylist}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Botões de Ação */}
          {selectedPlaylist && playlistVideos.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex space-x-3">
                <button
                  onClick={savePlaylist}
                  disabled={loading}
                  className="flex-1 bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {loading ? 'Salvando...' : 'Salvar Playlist'}
                </button>
                
                <button
                  onClick={saveAndStartPlaylist}
                  disabled={loading || transmissionStatus?.is_live}
                  className="flex-1 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center justify-center"
                >
                  <Radio className="h-4 w-4 mr-2" />
                  {loading ? 'Iniciando...' : 'Salvar e Transmitir'}
                </button>
              </div>
              
              <button
                onClick={() => setPlaylistVideos([])}
                className="w-full bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 flex items-center justify-center"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Limpar Playlist
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal Nova Playlist */}
      {showNewPlaylistModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Nova Playlist</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome da playlist:
              </label>
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                placeholder="Digite o nome da playlist"
                onKeyPress={(e) => e.key === 'Enter' && createPlaylist()}
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowNewPlaylistModal(false);
                  setNewPlaylistName('');
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={createPlaylist}
                disabled={!newPlaylistName.trim()}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                Criar Playlist
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Playlist */}
      {showEditModal && editingPlaylist && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Editar Playlist</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome da playlist:
              </label>
              <input
                type="text"
                value={editPlaylistName}
                onChange={(e) => setEditPlaylistName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                placeholder="Digite o novo nome da playlist"
                onKeyPress={(e) => e.key === 'Enter' && updatePlaylist()}
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingPlaylist(null);
                  setEditPlaylistName('');
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={updatePlaylist}
                disabled={!editPlaylistName.trim()}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center"
              >
                <Save className="h-4 w-4 mr-2" />
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Comerciais */}
      {showComercialModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Configurar Comerciais</h3>
                <button
                  onClick={() => setShowComercialModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mr-3 mt-0.5" />
                  <div className="text-yellow-800 text-sm">
                    <p className="font-medium mb-1">Como funciona:</p>
                    <ul className="space-y-1">
                      <li>• Selecione uma pasta que contém vídeos de comerciais</li>
                      <li>• Configure quantos comerciais inserir e a cada quantos vídeos</li>
                      <li>• Os comerciais serão inseridos automaticamente entre os vídeos da playlist</li>
                      <li>• Exemplo: 2 comerciais a cada 10 vídeos</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pasta de Comerciais *
                </label>
                <select
                  value={comercialConfig.pasta_comerciais}
                  onChange={(e) => setComercialConfig(prev => ({ ...prev, pasta_comerciais: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Selecione uma pasta de comerciais</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.nome_sanitizado}>
                      {folder.nome} ({folder.video_count_db || 0} vídeos)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Quantidade de Comerciais
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={comercialConfig.quantidade_comerciais}
                    onChange={(e) => setComercialConfig(prev => ({ ...prev, quantidade_comerciais: parseInt(e.target.value) || 1 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Quantos comerciais inserir por vez</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    A cada quantos vídeos
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={comercialConfig.intervalo_videos}
                    onChange={(e) => setComercialConfig(prev => ({ ...prev, intervalo_videos: parseInt(e.target.value) || 10 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Inserir comerciais a cada X vídeos</p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-blue-800 text-sm">
                  <strong>Exemplo:</strong> Com {comercialConfig.quantidade_comerciais} comercial(is) a cada {comercialConfig.intervalo_videos} vídeos, 
                  em uma playlist de 30 vídeos serão inseridos aproximadamente {Math.floor(30 / comercialConfig.intervalo_videos) * comercialConfig.quantidade_comerciais} comerciais.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowComercialModal(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={addComercials}
                disabled={!comercialConfig.pasta_comerciais}
                className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50"
              >
                Inserir Comerciais
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal do Player */}
      {showVideoModal && currentVideo && (
        <div
          className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeVideoPlayer();
            }
          }}
        >
          <div className="bg-black rounded-lg relative max-w-4xl w-full h-[70vh]">
            <button
              onClick={closeVideoPlayer}
              className="absolute top-4 right-4 z-20 text-white bg-red-600 hover:bg-red-700 rounded-full p-2 transition-colors duration-200 shadow-lg"
              title="Fechar player"
            >
              <X size={16} />
            </button>

            <div className="w-full h-full">
              <IFrameVideoPlayer
                src={buildVideoUrl(currentVideo)}
                title={currentVideo.nome}
                autoplay
                controls
                className="w-full h-full"
                onError={(error) => {
                  console.error('Erro no player:', error);
                  toast.error('Erro ao carregar vídeo');
                }}
                onReady={() => {
                  console.log('Player pronto');
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Informações de Ajuda */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start">
          <CheckCircle className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
          <div>
            <h3 className="text-blue-900 font-medium mb-2">🎵 Sistema de Playlists Avançado</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• <strong>Drag & Drop:</strong> Arraste vídeos para reordenar a playlist</li>
              <li>• <strong>Comerciais integrados:</strong> Insira comerciais automaticamente entre os vídeos</li>
              <li>• <strong>Transmissão SMIL:</strong> Playlists usam arquivo SMIL para transmissão no Wowza</li>
              <li>• <strong>Agendamentos:</strong> Agende playlists para transmitir automaticamente</li>
              <li>• <strong>Visualização em tempo real:</strong> Veja playlists em transmissão</li>
              <li>• <strong>Múltiplos formatos:</strong> Suporte a MP4, AVI, MOV, WMV, FLV, WebM, MKV</li>
              <li>• <strong>Controle de bitrate:</strong> Apenas vídeos dentro do limite são incluídos</li>
              <li>• <strong>Player integrado:</strong> Teste vídeos diretamente na interface</li>
              <li>• <strong>Estrutura de arquivos:</strong> /home/streaming/usuario/pasta/arquivo.mp4</li>
              <li>• <strong>URLs de transmissão:</strong> http://samhost.wcore.com.br:1935/usuario/usuario/playlist.m3u8</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Playlists;