import pytest


@pytest.mark.asyncio
async def test_teacher_roster_and_student_join_sync(client):
    # 1. Register Teacher A and Teacher B
    r_ta = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher A", "email": "ta_sync@example.com", "password": "password123"},
    )
    assert r_ta.status_code == 201
    ta_token = r_ta.json()["accessToken"]
    ta_headers = {"Authorization": f"Bearer {ta_token}"}

    r_tb = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher B", "email": "tb_sync@example.com", "password": "password123"},
    )
    assert r_tb.status_code == 201
    tb_token = r_tb.json()["accessToken"]
    tb_headers = {"Authorization": f"Bearer {tb_token}"}

    # 2. Register Students 1, 2, 3
    r_s1 = await client.post(
        "/auth/register/student",
        json={"name": "Student One", "email": "s1_sync@example.com", "password": "password123"},
    )
    assert r_s1.status_code == 201
    s1_token = r_s1.json()["accessToken"]
    s1_headers = {"Authorization": f"Bearer {s1_token}"}
    s1_id = r_s1.json()["user"]["id"]

    r_s2 = await client.post(
        "/auth/register/student",
        json={"name": "Student Two", "email": "s2_sync@example.com", "password": "password123"},
    )
    assert r_s2.status_code == 201
    s2_token = r_s2.json()["accessToken"]
    s2_headers = {"Authorization": f"Bearer {s2_token}"}
    s2_id = r_s2.json()["user"]["id"]

    r_s3 = await client.post(
        "/auth/register/student",
        json={"name": "Student Three", "email": "s3_sync@example.com", "password": "password123"},
    )
    assert r_s3.status_code == 201
    s3_token = r_s3.json()["accessToken"]
    s3_headers = {"Authorization": f"Bearer {s3_token}"}
    s3_id = r_s3.json()["user"]["id"]

    # 3. Teacher A creates Classroom A
    r_ca = await client.post(
        "/classrooms",
        json={"name": "CS 101", "subject": "CS"},
        headers=ta_headers,
    )
    assert r_ca.status_code == 201
    class_a = r_ca.json()
    ca_id = class_a["id"]
    ca_code = class_a["joinCode"]

    # 4. Teacher B creates Classroom B
    r_cb = await client.post(
        "/classrooms",
        json={"name": "Math 201", "subject": "Math"},
        headers=tb_headers,
    )
    assert r_cb.status_code == 201
    class_b = r_cb.json()
    cb_id = class_b["id"]
    cb_code = class_b["joinCode"]

    # 5. Verify newly created classroom has empty roster on both /students and /roster
    r_roster_empty = await client.get(f"/classrooms/{ca_id}/students", headers=ta_headers)
    assert r_roster_empty.status_code == 200
    assert r_roster_empty.json() == []

    r_roster_alias = await client.get(f"/classrooms/{ca_id}/roster", headers=ta_headers)
    assert r_roster_alias.status_code == 200
    assert r_roster_alias.json() == []

    # 6. Student 1 joins Classroom A
    r_j1 = await client.post("/classrooms/join", json={"joinCode": ca_code}, headers=s1_headers)
    assert r_j1.status_code == 200
    assert r_j1.json()["ok"] is True

    # 7. Teacher A roster now has Student 1
    r_roster_1 = await client.get(f"/classrooms/{ca_id}/students", headers=ta_headers)
    assert r_roster_1.status_code == 200
    students_a = r_roster_1.json()
    assert len(students_a) == 1
    assert students_a[0]["id"] == s1_id
    assert students_a[0]["name"] == "Student One"

    # 8. Student 2 and Student 3 join Classroom A
    r_j2 = await client.post("/classrooms/join", json={"joinCode": ca_code}, headers=s2_headers)
    assert r_j2.status_code == 200
    r_j3 = await client.post("/classrooms/join", json={"joinCode": ca_code}, headers=s3_headers)
    assert r_j3.status_code == 200

    # 9. Teacher A gets all 3 students
    r_roster_all = await client.get(f"/classrooms/{ca_id}/students", headers=ta_headers)
    assert r_roster_all.status_code == 200
    students_a_all = r_roster_all.json()
    assert len(students_a_all) == 3
    ids_in_a = {s["id"] for s in students_a_all}
    assert ids_in_a == {s1_id, s2_id, s3_id}

    # 10. Student 3 also joins Classroom B
    r_j3_b = await client.post("/classrooms/join", json={"joinCode": cb_code}, headers=s3_headers)
    assert r_j3_b.status_code == 200

    # 11. Teacher B only sees Student 3
    r_roster_b = await client.get(f"/classrooms/{cb_id}/students", headers=tb_headers)
    assert r_roster_b.status_code == 200
    students_b = r_roster_b.json()
    assert len(students_b) == 1
    assert students_b[0]["id"] == s3_id

    # 12. Cross-teacher isolation: Teacher A tries to view Classroom B students -> 403 Forbidden
    r_unauth = await client.get(f"/classrooms/{cb_id}/students", headers=ta_headers)
    assert r_unauth.status_code == 403

    # Teacher B tries to view Classroom A students -> 403 Forbidden
    r_unauth_b = await client.get(f"/classrooms/{ca_id}/students", headers=tb_headers)
    assert r_unauth_b.status_code == 403

    # 13. Student 1 leaves Classroom A
    r_leave = await client.delete(f"/classrooms/{ca_id}/membership", headers=s1_headers)
    assert r_leave.status_code == 200

    # 14. Teacher A roster automatically reflects removal of Student 1
    r_roster_after_leave = await client.get(f"/classrooms/{ca_id}/students", headers=ta_headers)
    assert r_roster_after_leave.status_code == 200
    remaining_in_a = {s["id"] for s in r_roster_after_leave.json()}
    assert remaining_in_a == {s2_id, s3_id}
    assert s1_id not in remaining_in_a
