function isAdmin(userId, adminIds) {
  if (!userId) {
    return false;
  }
  return adminIds.includes(String(userId));
}

module.exports = isAdmin;
