const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /api/comerciais - Lista configurações de comerciais
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        codigo_playlist as id_playlist,
        codigo_pasta_comerciais as id_folder_comerciais,
        quantidade_comerciais,
        intervalo_videos,
        ativo
       FROM comerciais_config 
       WHERE (codigo_stm = ? OR codigo_stm IN (
         SELECT codigo_cliente FROM streamings WHERE codigo = ?
       ))
       ORDER BY codigo`,
      [userId, userId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar comerciais:', err);
    res.status(500).json({ error: 'Erro ao buscar comerciais', details: err.message });
  }
});

// POST /api/comerciais - Cria configuração de comerciais
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      id_playlist,
      id_folder_comerciais,
      quantidade_comerciais,
      intervalo_videos,
      ativo
    } = req.body;

    const userId = req.user.id;

    if (!id_playlist || !id_folder_comerciais) {
      return res.status(400).json({ error: 'Playlist e pasta de comerciais são obrigatórios' });
    }

    // Buscar vídeos da pasta de comerciais
    const [comercialVideos] = await db.execute(
      `SELECT v.id, v.nome, v.url, v.caminho, v.duracao, v.duracao_segundos, v.bitrate_video,
              v.largura, v.altura, v.formato_original
       FROM videos v
       WHERE v.pasta = ? AND v.codigo_cliente = ?
       ORDER BY v.id ASC`,
      [id_folder_comerciais, userId]
    );

    if (comercialVideos.length === 0) {
      return res.status(400).json({ error: 'Nenhum vídeo encontrado na pasta de comerciais' });
    }

    // Buscar vídeos atuais da playlist (apenas vídeos, não comerciais)
    const [playlistVideos] = await db.execute(
      `SELECT v.id, v.ordem_playlist
       FROM videos v
       WHERE v.playlist_id = ? AND v.codigo_cliente = ?
       ORDER BY v.ordem_playlist ASC`,
      [id_playlist, userId]
    );

    // Remover comerciais existentes da playlist
    await db.execute(
      'DELETE FROM playlists_videos WHERE codigo_playlist = ? AND tipo = "comercial"',
      [id_playlist]
    );

    // Inserir comerciais baseado na lógica do PHP
    let contadorVideos = 1;
    let contadorInsercoes = 0;
    let contadorComerciaisInseridos = 0;
    const totalComerciais = comercialVideos.length;

    for (const video of playlistVideos) {
      if (contadorVideos === parseInt(intervalo_videos)) {
        // Inserir comerciais
        for (let i = 1; i <= parseInt(quantidade_comerciais); i++) {
          contadorComerciaisInseridos++;
          
          const ordem = `${video.ordem_playlist}.${i}`;
          const comercial = comercialVideos[contadorInsercoes];
          
          // Inserir comercial na tabela playlists_videos
          await db.execute(
            `INSERT INTO playlists_videos (
              codigo_playlist, path_video, video, width, height, bitrate,
              duracao, duracao_segundos, tipo, ordem
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'comercial', ?)`,
            [
              id_playlist,
              comercial.url || comercial.caminho,
              comercial.nome,
              comercial.largura || 1920,
              comercial.altura || 1080,
              comercial.bitrate_video || 2500,
              comercial.duracao || 0,
              comercial.duracao_segundos || comercial.duracao || 0,
              ordem
            ]
          );
          
          // Controlar ciclo de comerciais
          if (contadorComerciaisInseridos === totalComerciais) {
            contadorInsercoes = 0;
            contadorComerciaisInseridos = 0;
          } else {
            contadorInsercoes++;
          }
        }
        
        contadorVideos = 0;
      }
      
      contadorVideos++;
    }

    // Marcar playlist como tendo comerciais
    await db.execute(
      'UPDATE playlists SET comerciais = "sim" WHERE id = ?',
      [id_playlist]
    );
    const [result] = await db.execute(
      `INSERT INTO comerciais_config (
        codigo_stm, codigo_playlist, codigo_pasta_comerciais,
        quantidade_comerciais, intervalo_videos, ativo
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, id_playlist, id_folder_comerciais, quantidade_comerciais || 1, intervalo_videos || 3, ativo ? 1 : 0]
    );

    // Atualizar arquivo SMIL da playlist
    try {
      const userLogin = req.user.usuario || (req.user.email ? req.user.email.split('@')[0] : `user_${req.user.id}`);
      const [serverRows] = await db.execute(
        'SELECT servidor_id FROM folders WHERE user_id = ? LIMIT 1',
        [req.user.id]
      );
      const serverId = serverRows.length > 0 ? serverRows[0].servidor_id : 1;
      
      const PlaylistSMILService = require('../services/PlaylistSMILService');
      await PlaylistSMILService.generatePlaylistSMIL(req.user.id, userLogin, serverId, id_playlist);
      console.log(`✅ Arquivo SMIL atualizado após inserir comerciais na playlist ${id_playlist}`);
    } catch (smilError) {
      console.warn('Erro ao atualizar arquivo SMIL:', smilError.message);
    }
    res.status(201).json({
      id: result.insertId,
      message: `Comerciais inseridos com sucesso na playlist! ${comercialVideos.length} comerciais disponíveis.`
    });
  } catch (err) {
    console.error('Erro ao criar comerciais:', err);
    res.status(500).json({ error: 'Erro ao criar comerciais', details: err.message });
  }
});

// PUT /api/comerciais/:id - Atualiza configuração de comerciais
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const comercialId = req.params.id;
    const userId = req.user.id;
    const { ativo, quantidade_comerciais, intervalo_videos } = req.body;

    // Verificar se configuração pertence ao usuário
    const [comercialRows] = await db.execute(
      'SELECT codigo FROM comerciais_config WHERE codigo = ? AND codigo_stm = ?',
      [comercialId, userId]
    );

    if (comercialRows.length === 0) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    // Atualizar configuração
    const updates = [];
    const values = [];

    if (typeof ativo !== 'undefined') {
      updates.push('ativo = ?');
      values.push(ativo ? 1 : 0);
    }

    if (quantidade_comerciais) {
      updates.push('quantidade_comerciais = ?');
      values.push(quantidade_comerciais);
    }

    if (intervalo_videos) {
      updates.push('intervalo_videos = ?');
      values.push(intervalo_videos);
    }

    if (updates.length > 0) {
      values.push(comercialId);
      await db.execute(
        `UPDATE comerciais_config SET ${updates.join(', ')} WHERE codigo = ?`,
        values
      );
    }

    res.json({ success: true, message: 'Configuração atualizada com sucesso' });
  } catch (err) {
    console.error('Erro ao atualizar comerciais:', err);
    res.status(500).json({ error: 'Erro ao atualizar comerciais', details: err.message });
  }
});

// DELETE /api/comerciais/:id - Remove configuração de comerciais
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const comercialId = req.params.id;
    const userId = req.user.id;

    // Verificar se configuração pertence ao usuário
    const [comercialRows] = await db.execute(
      'SELECT codigo FROM comerciais_config WHERE codigo = ? AND codigo_stm = ?',
      [comercialId, userId]
    );

    if (comercialRows.length === 0) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    // Remover configuração
    await db.execute(
      'DELETE FROM comerciais_config WHERE codigo = ?',
      [comercialId]
    );

    res.json({ success: true, message: 'Configuração removida com sucesso' });
  } catch (err) {
    console.error('Erro ao remover comerciais:', err);
    res.status(500).json({ error: 'Erro ao remover comerciais', details: err.message });
  }
});

module.exports = router;