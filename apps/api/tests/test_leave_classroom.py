import pytest
from app.core.security import create_access_token

@pytest.fixture
def auth_headers():
    def _make(sub: str, role: str):
        token = create_access_token(sub, role=role)
        return {"Authorization": f"Bearer {token}"}
    return _make


@pytest.mark.asyncio
async def test_leave_classroom_full_isolation_and_cleanup(client):
    # 1. Register users in DB and obtain real access tokens
    r_t = await client.post("/auth/register/teacher", json={"name": "Teacher One", "email": "t1@example.com", "password": "password123"})
    assert r_t.status_code == 201
    teacher_h = {"Authorization": f"Bearer {r_t.json()['accessToken']}"}

    r_sa = await client.post("/auth/register/student", json={"name": "Student A", "email": "sa@example.com", "password": "password123"})
    assert r_sa.status_code == 201
    student_a_h = {"Authorization": f"Bearer {r_sa.json()['accessToken']}"}

    r_sb = await client.post("/auth/register/student", json={"name": "Student B", "email": "sb@example.com", "password": "password123"})
    assert r_sb.status_code == 201
    student_b_h = {"Authorization": f"Bearer {r_sb.json()['accessToken']}"}

    # 2. Teacher creates Classroom A and Classroom B
    r_ca = await client.post("/classrooms", json={"name": "Classroom A", "subject": "CS"}, headers=teacher_h)
    assert r_ca.status_code == 201
    class_a = r_ca.json()
    code_a = class_a["joinCode"]
    id_a = class_a["id"]

    r_cb = await client.post("/classrooms", json={"name": "Classroom B", "subject": "Math"}, headers=teacher_h)
    assert r_cb.status_code == 201
    class_b = r_cb.json()
    code_b = class_b["joinCode"]
    id_b = class_b["id"]

    # 3. Create Note and Test in Classroom A with concept 'concept_a'
    r_na = await client.post("/notes", json={"title": "Note A", "classroomId": id_a, "published": True, "conceptIds": ["concept_a"]}, headers=teacher_h)
    assert r_na.status_code == 201

    r_ta = await client.post("/tests", json={
        "title": "Test A",
        "classroomId": id_a,
        "status": "published",
        "conceptIds": ["concept_a"],
        "questions": [{"id": "q1", "prompt": "1+1", "options": ["2"], "answer": "2", "conceptId": "concept_a"}],
    }, headers=teacher_h)
    assert r_ta.status_code == 201
    test_a_id = r_ta.json()["id"]

    # 4. Create Note and Test in Classroom B with concept 'concept_b'
    r_nb = await client.post("/notes", json={"title": "Note B", "classroomId": id_b, "published": True, "conceptIds": ["concept_b"]}, headers=teacher_h)
    assert r_nb.status_code == 201

    r_tb = await client.post("/tests", json={
        "title": "Test B",
        "classroomId": id_b,
        "status": "published",
        "conceptIds": ["concept_b"],
        "questions": [{"id": "q2", "prompt": "2+2", "options": ["4"], "answer": "4", "conceptId": "concept_b"}],
    }, headers=teacher_h)
    assert r_tb.status_code == 201
    test_b_id = r_tb.json()["id"]

    # 5. Enrollments: Student A in A and B; Student B in A
    r = await client.post("/classrooms/join", json={"joinCode": code_a}, headers=student_a_h)
    assert r.status_code == 200
    r = await client.post("/classrooms/join", json={"joinCode": code_b}, headers=student_a_h)
    assert r.status_code == 200
    r = await client.post("/classrooms/join", json={"joinCode": code_a}, headers=student_b_h)
    assert r.status_code == 200

    # 6. Verify Classroom concepts populated in GET /classrooms
    ca_check = await client.get(f"/classrooms/{id_a}", headers=student_a_h)
    assert "concept_a" in ca_check.json()["conceptIds"]

    # 7. Student submissions:
    # Student A submits Test A and Test B
    sub_a_a = await client.post(f"/tests/{test_a_id}/submit", json={"answers": {"q1": "2"}}, headers=student_a_h)
    assert sub_a_a.status_code == 200
    assert sub_a_a.json()["score"] == 100

    sub_a_b = await client.post(f"/tests/{test_b_id}/submit", json={"answers": {"q2": "4"}}, headers=student_a_h)
    assert sub_a_b.status_code == 200

    # Student B submits Test A
    sub_b_a = await client.post(f"/tests/{test_a_id}/submit", json={"answers": {"q1": "2"}}, headers=student_b_h)
    assert sub_b_a.status_code == 200

    # Check Student A mastery before leaving: has concept_a and concept_b
    m_a_before = (await client.get("/analytics/mastery", headers=student_a_h)).json()
    assert "concept_a" in m_a_before
    assert "concept_b" in m_a_before

    # 8. Student A leaves Classroom A
    leave_resp = await client.delete(f"/classrooms/{id_a}/membership", headers=student_a_h)
    assert leave_resp.status_code == 200
    assert leave_resp.json()["ok"] is True

    # 9. Verify Student A's state after leaving Classroom A:
    # - Classroom A is NOT in student A's classrooms
    sa_classes = (await client.get("/classrooms", headers=student_a_h)).json()
    sa_class_ids = [c["id"] for c in sa_classes]
    assert id_a not in sa_class_ids
    assert id_b in sa_class_ids

    # - Submissions: Test A submission removed, Test B submission remains
    sa_subs = (await client.get("/submissions", headers=student_a_h)).json()
    sa_sub_test_ids = [s["testId"] for s in sa_subs]
    assert test_a_id not in sa_sub_test_ids
    assert test_b_id in sa_sub_test_ids

    # - Notes: Note A is inaccessible, Note B is accessible
    note_a_check = await client.get(f"/notes/{r_na.json()['id']}", headers=student_a_h)
    assert note_a_check.status_code == 403
    note_b_check = await client.get(f"/notes/{r_nb.json()['id']}", headers=student_a_h)
    assert note_b_check.status_code == 200

    # - Mastery: concept_a is removed, concept_b remains!
    m_a_after = (await client.get("/analytics/mastery", headers=student_a_h)).json()
    assert "concept_a" not in m_a_after
    assert "concept_b" in m_a_after

    # 10. Verify Student B's state is UNTOUCHED:
    # - Still in Classroom A
    sb_classes = (await client.get("/classrooms", headers=student_b_h)).json()
    assert any(c["id"] == id_a for c in sb_classes)

    # - Test A submission remains
    sb_subs = (await client.get("/submissions", headers=student_b_h)).json()
    assert any(s["testId"] == test_a_id for s in sb_subs)

    # - Mastery for concept_a remains
    m_b = (await client.get("/analytics/mastery", headers=student_b_h)).json()
    assert "concept_a" in m_b

    # 11. Verify Teacher and Classroom A data are UNTOUCHED:
    # - Classroom A still exists
    ca_teacher = await client.get(f"/classrooms/{id_a}", headers=teacher_h)
    assert ca_teacher.status_code == 200
    assert ca_teacher.json()["name"] == "Classroom A"
    assert ca_teacher.json()["joinCode"] == code_a

    # - Teacher student list: Student B is there, Student A is NOT
    class_students = (await client.get(f"/classrooms/{id_a}/students", headers=teacher_h)).json()
    enrolled_emails = [s["email"] for s in class_students]
    assert "sa@example.com" not in enrolled_emails
    assert "sb@example.com" in enrolled_emails

    # - Teacher notes and tests in Classroom A remain
    t_notes = (await client.get(f"/notes?classroomId={id_a}", headers=teacher_h)).json()
    assert len(t_notes) == 1
    t_tests = (await client.get(f"/tests?classroomId={id_a}", headers=teacher_h)).json()
    assert len(t_tests) == 1

    # 12. Student A leaves remaining Classroom B -> Empty state
    leave_b = await client.delete(f"/classrooms/{id_b}/membership", headers=student_a_h)
    assert leave_b.status_code == 200

    sa_classes_empty = (await client.get("/classrooms", headers=student_a_h)).json()
    assert len(sa_classes_empty) == 0

    sa_subs_empty = (await client.get("/submissions", headers=student_a_h)).json()
    assert len(sa_subs_empty) == 0

    sa_mastery_empty = (await client.get("/analytics/mastery", headers=student_a_h)).json()
    assert len(sa_mastery_empty) == 0

    # 13. Re-enrollment behavior: Student A rejoins Classroom A
    rejoin = await client.post("/classrooms/join", json={"joinCode": code_a}, headers=student_a_h)
    assert rejoin.status_code == 200

    # Fresh participant verification: 0 previous submissions, 0 previous mastery for concept_a
    sa_subs_rejoined = (await client.get("/submissions", headers=student_a_h)).json()
    assert len(sa_subs_rejoined) == 0

    sa_mastery_rejoined = (await client.get("/analytics/mastery", headers=student_a_h)).json()
    assert "concept_a" not in sa_mastery_rejoined


@pytest.mark.asyncio
async def test_leave_classroom_authorization_and_validation(client, auth_headers):
    teacher_h = auth_headers("teacher_1", "teacher")
    student_h = auth_headers("student_1", "student")

    # Teacher creates class
    r_c = await client.post("/classrooms", json={"name": "Class 1"}, headers=teacher_h)
    cid = r_c.json()["id"]

    # Teacher cannot call leave endpoint (403 Forbidden)
    r_teach_leave = await client.delete(f"/classrooms/{cid}/membership", headers=teacher_h)
    assert r_teach_leave.status_code == 403

    # Unauthenticated cannot call leave (401)
    r_anon = await client.delete(f"/classrooms/{cid}/membership")
    assert r_anon.status_code == 401

    # Student not enrolled cannot leave (404)
    r_not_enrolled = await client.delete(f"/classrooms/{cid}/membership", headers=student_h)
    assert r_not_enrolled.status_code == 404

    # Nonexistent classroom ID (404)
    r_no_class = await client.delete("/classrooms/nonexistent-id/membership", headers=student_h)
    assert r_no_class.status_code == 404
